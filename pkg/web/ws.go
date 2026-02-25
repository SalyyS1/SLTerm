// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/SalyyS1/SLTerm/pkg/authkey"
	"github.com/SalyyS1/SLTerm/pkg/baseds"
	"github.com/SalyyS1/SLTerm/pkg/eventbus"
	"github.com/SalyyS1/SLTerm/pkg/panichandler"
	"github.com/SalyyS1/SLTerm/pkg/web/webcmd"
	"github.com/SalyyS1/SLTerm/pkg/wshutil"
)

const wsReadWaitTimeout = 15 * time.Second
const wsWriteWaitTimeout = 10 * time.Second
const wsPingPeriodTickTime = 10 * time.Second
const wsInitialPingTime = 1 * time.Second
const wsMaxMessageSize = 10 * 1024 * 1024

const DefaultCommandTimeout = 2 * time.Second
const WebSocketChannelSize = 128

type StableConnInfo struct {
	ConnId string
	LinkId baseds.LinkId
}

var GlobalLock = &sync.Mutex{}
var RouteToConnMap = map[string]*StableConnInfo{} // stableid => StableConnInfo

func RunWebSocketServer(listener net.Listener) {
	gr := mux.NewRouter()
	gr.HandleFunc("/ws", HandleWs)
	server := &http.Server{
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        gr,
	}
	server.SetKeepAlivesEnabled(false)
	log.Printf("[websocket] running websocket server on %s\n", listener.Addr())
	err := server.Serve(listener)
	if err != nil {
		log.Printf("[websocket] error trying to run websocket server: %v\n", err)
	}
}

var WebSocketUpgrader = websocket.Upgrader{
	ReadBufferSize:   4 * 1024,
	WriteBufferSize:  32 * 1024,
	HandshakeTimeout: 1 * time.Second,
	CheckOrigin:      func(r *http.Request) bool { return true },
}

func HandleWs(w http.ResponseWriter, r *http.Request) {
	err := HandleWsInternal(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func getMessageType(jmsg map[string]any) string {
	if str, ok := jmsg["type"].(string); ok {
		return str
	}
	return ""
}

// getMessageTypeFromBytes extracts the "type" field from a raw JSON message without
// full unmarshalling — used by the write path to detect control messages quickly.
func getMessageTypeFromBytes(barr []byte) string {
	var quick struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(barr, &quick); err != nil {
		return ""
	}
	return quick.Type
}

func getStringFromMap(jmsg map[string]any, key string) string {
	if str, ok := jmsg[key].(string); ok {
		return str
	}
	return ""
}

func processWSCommand(jmsg map[string]any, outputCh chan any, rpcInputCh chan baseds.RpcInputChType) {
	var rtnErr error
	var cmdType string
	defer func() {
		panicCtx := "processWSCommand"
		if cmdType != "" {
			panicCtx = fmt.Sprintf("processWSCommand:%s", cmdType)
		}
		panicErr := panichandler.PanicHandler(panicCtx, recover())
		if panicErr != nil {
			rtnErr = panicErr
		}
		if rtnErr == nil {
			return
		}
		rtn := map[string]any{"type": "error", "error": rtnErr.Error()}
		outputCh <- rtn
	}()
	wsCommand, err := webcmd.ParseWSCommandMap(jmsg)
	if err != nil {
		rtnErr = fmt.Errorf("cannot parse wscommand: %v", err)
		return
	}
	cmdType = wsCommand.GetWSCommand()
	switch cmd := wsCommand.(type) {
	case *webcmd.WSRpcCommand:
		rpcMsg := cmd.Message
		if rpcMsg == nil {
			return
		}
		if rpcMsg.Command != "" {
			cmdType = fmt.Sprintf("%s:%s", cmdType, rpcMsg.Command)
		}
		msgBytes, err := json.Marshal(rpcMsg)
		if err != nil {
			// this really should never fail since we just unmarshalled this value
			return
		}
		rpcInputCh <- baseds.RpcInputChType{MsgBytes: msgBytes}
	}
}

func ReadLoop(conn *websocket.Conn, outputCh chan any, closeCh chan any, rpcInputCh chan baseds.RpcInputChType, routeId string) {
	readWait := wsReadWaitTimeout
	conn.SetReadLimit(wsMaxMessageSize)
	conn.SetReadDeadline(time.Now().Add(readWait))
	defer close(closeCh)
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[websocket] ReadPump error (%s): %v\n", routeId, err)
			break
		}
		jmsg := map[string]any{}
		err = json.Unmarshal(message, &jmsg)
		if err != nil {
			log.Printf("[websocket] error unmarshalling json: %v\n", err)
			break
		}
		conn.SetReadDeadline(time.Now().Add(readWait))
		msgType := getMessageType(jmsg)
		if msgType == "pong" {
			// nothing
			continue
		}
		if msgType == "ping" {
			now := time.Now()
			pongMessage := map[string]interface{}{"type": "pong", "stime": now.UnixMilli()}
			outputCh <- pongMessage
			continue
		}
		wsCommand := getStringFromMap(jmsg, "wscommand")
		if wsCommand == "" {
			continue
		}
		processWSCommand(jmsg, outputCh, rpcInputCh)
	}
}

func WritePing(conn *websocket.Conn) error {
	now := time.Now()
	pingMessage := map[string]interface{}{"type": "ping", "stime": now.UnixMilli()}
	jsonVal, _ := json.Marshal(pingMessage)
	_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWaitTimeout)) // no error
	err := conn.WriteMessage(websocket.TextMessage, jsonVal)
	if err != nil {
		return err
	}
	return nil
}

// wsBatchWindow is the maximum delay before flushing a batch of WebSocket messages.
// 16ms matches a single animation frame — imperceptible latency, high throughput gain.
const wsBatchWindow = 16 * time.Millisecond

// WSBatcher coalesces outbound JSON WebSocket messages within a 16ms window.
// Wire format: [count uint32 LE][len1 uint32 LE][msg1 bytes][len2 uint32 LE][msg2 bytes]...
// Control messages (ping/pong/error type) bypass batching and are sent immediately.
// Thread-safe: Send() may be called from multiple goroutines.
type WSBatcher struct {
	conn    *websocket.Conn
	mu      sync.Mutex
	batch   [][]byte
	timer   *time.Timer
	maxWait time.Duration
}

func newWSBatcher(conn *websocket.Conn) *WSBatcher {
	return &WSBatcher{conn: conn, maxWait: wsBatchWindow}
}

// Send queues msg for batched delivery. If this is the first message in a new
// batch window, a flush timer is started. Thread-safe.
func (b *WSBatcher) Send(msg []byte) error {
	b.mu.Lock()
	b.batch = append(b.batch, msg)
	if b.timer == nil {
		b.timer = time.AfterFunc(b.maxWait, func() {
			b.mu.Lock()
			defer b.mu.Unlock()
			b.flushLocked()
		})
	}
	b.mu.Unlock()
	return nil
}

// SendImmediate bypasses batching — used for ping/pong and close frames.
func (b *WSBatcher) SendImmediate(msg []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	// flush any pending batch first so ordering is preserved
	b.flushLocked()
	_ = b.conn.SetWriteDeadline(time.Now().Add(wsWriteWaitTimeout))
	return b.conn.WriteMessage(websocket.TextMessage, msg)
}

// flushLocked must be called with b.mu held. Sends all queued messages as a
// single binary batch frame, or as individual text frames if only one queued.
func (b *WSBatcher) flushLocked() {
	if len(b.batch) == 0 {
		return
	}
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
	msgs := b.batch
	b.batch = nil

	_ = b.conn.SetWriteDeadline(time.Now().Add(wsWriteWaitTimeout))
	if len(msgs) == 1 {
		// single message — send as plain text frame (no envelope overhead)
		b.conn.WriteMessage(websocket.TextMessage, msgs[0]) //nolint:errcheck
		return
	}
	// multi-message: encode batch envelope and send as one binary frame
	frame := combineBatch(msgs)
	b.conn.WriteMessage(websocket.BinaryMessage, frame) //nolint:errcheck
}

// combineBatch encodes messages into the batch envelope:
// [count:4B LE][len0:4B LE][msg0][len1:4B LE][msg1]...
func combineBatch(msgs [][]byte) []byte {
	total := 4 // count field
	for _, m := range msgs {
		total += 4 + len(m) // length prefix + payload
	}
	frame := make([]byte, total)
	binary.LittleEndian.PutUint32(frame[0:4], uint32(len(msgs)))
	offset := 4
	for _, m := range msgs {
		binary.LittleEndian.PutUint32(frame[offset:offset+4], uint32(len(m)))
		offset += 4
		copy(frame[offset:], m)
		offset += len(m)
	}
	return frame
}

func WriteLoop(conn *websocket.Conn, outputCh chan any, closeCh chan any, routeId string) {
	ticker := time.NewTicker(wsInitialPingTime)
	defer ticker.Stop()
	initialPing := true
	batcher := newWSBatcher(conn)
	for {
		select {
		case msg := <-outputCh:
			var barr []byte
			var err error
			if _, ok := msg.([]byte); ok {
				barr = msg.([]byte)
			} else {
				barr, err = json.Marshal(msg)
				if err != nil {
					log.Printf("[websocket] cannot marshal websocket message: %v\n", err)
					break
				}
			}
			// control messages (ping/pong/error) bypass batching for immediacy
			if msgType := getMessageTypeFromBytes(barr); msgType == "ping" || msgType == "pong" || msgType == "error" {
				if err := batcher.SendImmediate(barr); err != nil {
					conn.Close()
					log.Printf("[websocket] WritePump error (%s): %v\n", routeId, err)
					return
				}
			} else {
				if err := batcher.Send(barr); err != nil {
					conn.Close()
					log.Printf("[websocket] WritePump error (%s): %v\n", routeId, err)
					return
				}
			}

		case <-ticker.C:
			err := WritePing(conn)
			if err != nil {
				log.Printf("[websocket] WritePump error (%s): %v\n", routeId, err)
				return
			}
			if initialPing {
				initialPing = false
				ticker.Reset(wsPingPeriodTickTime)
			}

		case <-closeCh:
			return
		}
	}
}

func registerConn(wsConnId string, stableId string, wproxy *wshutil.WshRpcProxy) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	curConnInfo := RouteToConnMap[stableId]
	if curConnInfo != nil {
		log.Printf("[websocket] warning: replacing existing connection for stableid %q\n", stableId)
		if curConnInfo.LinkId != baseds.NoLinkId {
			wshutil.DefaultRouter.UnregisterLink(curConnInfo.LinkId)
		}
	}
	linkId := wshutil.DefaultRouter.RegisterTrustedRouter(wproxy)
	RouteToConnMap[stableId] = &StableConnInfo{
		ConnId: wsConnId,
		LinkId: linkId,
	}
}

func unregisterConn(wsConnId string, stableId string) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	curConnInfo := RouteToConnMap[stableId]
	if curConnInfo == nil || curConnInfo.ConnId != wsConnId {
		log.Printf("[websocket] warning: trying to unregister connection %q for stableid %q but it is not the current connection (ignoring)\n", wsConnId, stableId)
		return
	}
	delete(RouteToConnMap, stableId)
	if curConnInfo.LinkId != baseds.NoLinkId {
		wshutil.DefaultRouter.UnregisterLink(curConnInfo.LinkId)
	}
}

func HandleWsInternal(w http.ResponseWriter, r *http.Request) error {
	stableId := r.URL.Query().Get("stableid")
	if stableId == "" {
		return fmt.Errorf("stableid is required")
	}
	err := authkey.ValidateIncomingRequest(r)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(fmt.Sprintf("error validating authkey: %v", err)))
		log.Printf("[websocket] error validating authkey: %v\n", err)
		return err
	}
	conn, err := WebSocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return fmt.Errorf("WebSocket Upgrade Failed: %v", err)
	}
	defer conn.Close()
	wsConnId := uuid.New().String()
	outputCh := make(chan any, WebSocketChannelSize)
	closeCh := make(chan any)
	log.Printf("[websocket] new connection: connid:%s stableid:%s\n", wsConnId, stableId)
	eventbus.RegisterWSChannel(wsConnId, stableId, outputCh)
	defer eventbus.UnregisterWSChannel(wsConnId)
	wproxy := wshutil.MakeRpcProxyWithSize(fmt.Sprintf("ws:%s", stableId), WebSocketChannelSize, WebSocketChannelSize)
	defer close(wproxy.ToRemoteCh)
	registerConn(wsConnId, stableId, wproxy)
	defer unregisterConn(wsConnId, stableId)
	wg := &sync.WaitGroup{}
	wg.Add(2)
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:outputCh", recover())
		}()
		// no waitgroup add here
		// move values from rpcOutputCh to outputCh
		for msgBytes := range wproxy.ToRemoteCh {
			rpcWSMsg := map[string]any{
				"eventtype": "rpc", // TODO don't hard code this (but def is in eventbus)
				"data":      json.RawMessage(msgBytes),
			}
			outputCh <- rpcWSMsg
		}
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:ReadLoop", recover())
		}()
		defer wg.Done()
		ReadLoop(conn, outputCh, closeCh, wproxy.FromRemoteCh, stableId)
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:WriteLoop", recover())
		}()
		defer wg.Done()
		WriteLoop(conn, outputCh, closeCh, stableId)
	}()
	wg.Wait()
	close(wproxy.FromRemoteCh)
	return nil
}
