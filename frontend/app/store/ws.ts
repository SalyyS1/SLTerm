// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

import { type WebSocket, newWebSocket } from "@/util/wsutil";
import debug from "debug";
import { sprintf } from "sprintf-js";

const AuthKeyHeader = "X-AuthKey";

const dlog = debug("wave:ws");

const WarnWebSocketSendSize = 1024 * 1024; // 1MB
const MaxWebSocketSendSize = 5 * 1024 * 1024; // 5MB
const reconnectHandlers: (() => void)[] = [];
const StableConnTime = 2000;

function addWSReconnectHandler(handler: () => void) {
    reconnectHandlers.push(handler);
}

function removeWSReconnectHandler(handler: () => void) {
    const index = reconnectHandlers.indexOf(handler);
    if (index > -1) {
        reconnectHandlers.splice(index, 1);
    }
}

type WSEventCallback = (arg0: WSEventType) => void;

type ElectronOverrideOpts = {
    authKey: string;
};

class WSControl {
    wsConn: WebSocket;
    open: boolean;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: any[] = [];
    stableId: string;
    messageCallback: WSEventCallback;
    watchSessionId: string = null;
    watchScreenId: string = null;
    wsLog: string[] = [];
    baseHostPort: string;
    lastReconnectTime: number = 0;
    eoOpts: ElectronOverrideOpts;
    noReconnect: boolean = false;
    onOpenTimeoutId: NodeJS.Timeout = null;

    private pingIntervalId: ReturnType<typeof setInterval> | null = null;

    constructor(
        baseHostPort: string,
        stableId: string,
        messageCallback: WSEventCallback,
        electronOverrideOpts?: ElectronOverrideOpts
    ) {
        this.baseHostPort = baseHostPort;
        this.messageCallback = messageCallback;
        this.stableId = stableId;
        this.open = false;
        this.eoOpts = electronOverrideOpts;
        this.pingIntervalId = setInterval(this.sendPing.bind(this), 5000);
    }

    shutdown() {
        this.noReconnect = true;
        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
        }
        this.wsConn.close();
    }

    connectNow(desc: string) {
        if (this.open || this.noReconnect) {
            return;
        }
        this.lastReconnectTime = Date.now();
        dlog("try reconnect:", desc);
        this.opening = true;
        this.wsConn = newWebSocket(
            this.baseHostPort + "/ws?stableid=" + encodeURIComponent(this.stableId),
            this.eoOpts
                ? {
                      [AuthKeyHeader]: this.eoOpts.authKey,
                  }
                : null
        );
        this.wsConn.binaryType = "arraybuffer";
        this.wsConn.onopen = (e: Event) => {
            this.onopen(e);
        };
        this.wsConn.onmessage = (e: MessageEvent) => {
            this.onmessage(e);
        };
        this.wsConn.onclose = (e: CloseEvent) => {
            this.onclose(e);
        };
        // turns out onerror is not necessary (onclose always follows onerror)
        // this.wsConn.onerror = this.onerror;
    }

    reconnect(forceClose?: boolean) {
        if (this.noReconnect) {
            return;
        }
        if (this.open) {
            if (forceClose) {
                this.wsConn.close(); // this will force a reconnect
            }
            return;
        }
        this.reconnectTimes++;
        if (this.reconnectTimes > 50) {
            dlog("cannot connect, giving up");
            return;
        }
        const timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
        let timeout = 60;
        if (this.reconnectTimes < timeoutArr.length) {
            timeout = timeoutArr[this.reconnectTimes];
        }
        if (Date.now() - this.lastReconnectTime < 500) {
            timeout = 1;
        }
        if (timeout > 0) {
            dlog(sprintf("sleeping %ds", timeout));
        }
        setTimeout(() => {
            this.connectNow(String(this.reconnectTimes));
        }, timeout * 1000);
    }

    onclose(event: CloseEvent) {
        // console.log("close", event);
        if (this.onOpenTimeoutId) {
            clearTimeout(this.onOpenTimeoutId);
        }
        if (event.wasClean) {
            dlog("connection closed");
        } else {
            dlog("connection error/disconnected");
        }
        if (this.open || this.opening) {
            this.open = false;
            this.opening = false;
            this.reconnect();
        }
    }

    onopen(e: Event) {
        dlog("connection open");
        this.open = true;
        this.opening = false;
        this.onOpenTimeoutId = setTimeout(() => {
            this.reconnectTimes = 0;
            dlog("clear reconnect times");
        }, StableConnTime);
        for (let handler of reconnectHandlers) {
            handler();
        }
        this.runMsgQueue();
    }

    runMsgQueue() {
        if (!this.open) {
            return;
        }
        while (this.msgQueue.length > 0) {
            const msg = this.msgQueue.shift();
            this.sendMessage(msg);
        }
    }

    decodeBinaryBatch(buf: Uint8Array) {
        if (buf.byteLength < 4) {
            return;
        }
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const count = view.getUint32(0, true); // little-endian
        let offset = 4;
        for (let i = 0; i < count; i++) {
            if (offset + 4 > buf.byteLength) break;
            const msgLen = view.getUint32(offset, true);
            offset += 4;
            if (offset + msgLen > buf.byteLength) break;
            const msgBytes = buf.subarray(offset, offset + msgLen);
            offset += msgLen;
            const msgStr = new TextDecoder().decode(msgBytes);
            try {
                const msgData = JSON.parse(msgStr);
                this.processMessage(msgData);
            } catch (e) {
                console.log("[ws] error parsing batch message", i, e);
            }
        }
    }

    onmessage(event: MessageEvent) {
        const data = event.data;
        if (data == null) {
            return;
        }
        // Binary batch frame: Go WSBatcher sends multiple messages in one BinaryMessage
        // Wire format: [count:4B LE][len0:4B LE][msg0 bytes][len1:4B LE][msg1 bytes]...
        if (typeof data !== "string") {
            // Handle Blob — browser WebSocket default binary type
            if (data instanceof Blob) {
                data.arrayBuffer().then((ab) => {
                    this.decodeBinaryBatch(new Uint8Array(ab));
                });
                return;
            }
            let buf: Uint8Array;
            if (data instanceof ArrayBuffer) {
                buf = new Uint8Array(data);
            } else if (ArrayBuffer.isView(data)) {
                buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
                buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            } else {
                console.log("[ws] unknown binary data type, skipping", typeof data);
                return;
            }
            this.decodeBinaryBatch(buf);
            return;
        }
        // Text frame: single JSON message
        let eventData = null;
        try {
            eventData = JSON.parse(data);
        } catch (e) {
            console.log("[ws] error parsing text message", e);
            return;
        }
        if (eventData == null) {
            return;
        }
        this.processMessage(eventData);
    }

    processMessage(eventData: any) {
        if (eventData.type == "ping") {
            this.wsConn.send(JSON.stringify({ type: "pong", stime: Date.now() }));
            return;
        }
        if (eventData.type == "pong") {
            // nothing
            return;
        }
        if (this.messageCallback) {
            try {
                this.messageCallback(eventData);
            } catch (e) {
                console.log("[error] messageCallback", e);
            }
        }
    }

    sendPing() {
        if (!this.open) {
            return;
        }
        this.wsConn.send(JSON.stringify({ type: "ping", stime: Date.now() }));
    }

    sendMessage(data: WSCommandType) {
        if (!this.open) {
            return;
        }
        const msg = JSON.stringify(data);
        const byteSize = msg.length * 3; // conservative upper bound (UTF-8 worst case)
        if (byteSize > MaxWebSocketSendSize) {
            console.log("ws message too large", byteSize, data.wscommand, msg.substring(0, 100));
            return;
        }
        if (byteSize > WarnWebSocketSendSize) {
            console.log("ws message large", byteSize, data.wscommand, msg.substring(0, 100));
        }
        this.wsConn.send(msg);
    }

    pushMessage(data: WSCommandType) {
        if (!this.open) {
            if (data.wscommand === "rpc" && data.message) {
                const cmd = data.message.command;
                if (cmd === "routeannounce" || cmd === "routeunannounce") {
                    return;
                }
            }
            this.msgQueue.push(data);
            return;
        }
        this.sendMessage(data);
    }
}

let globalWS: WSControl;
function initGlobalWS(
    baseHostPort: string,
    stableId: string,
    messageCallback: WSEventCallback,
    electronOverrideOpts?: ElectronOverrideOpts
) {
    globalWS = new WSControl(baseHostPort, stableId, messageCallback, electronOverrideOpts);
}

function sendRawRpcMessage(msg: RpcMessage) {
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    sendWSCommand(wsMsg);
}

function sendWSCommand(cmd: WSCommandType) {
    globalWS?.pushMessage(cmd);
}

export {
    WSControl,
    addWSReconnectHandler,
    globalWS,
    initGlobalWS,
    removeWSReconnectHandler,
    sendRawRpcMessage,
    sendWSCommand,
    type ElectronOverrideOpts,
};
