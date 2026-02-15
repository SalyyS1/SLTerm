// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"sync"

	"github.com/SalyyS1/SLTerm/pkg/wshrpc"
	"github.com/SalyyS1/SLTerm/pkg/wshutil"
)

const (
	DefaultOutputChSize = 32
	DefaultInputChSize  = 32
)

var waveSrvClient_Singleton *wshutil.WshRpc
var waveSrvClient_Once = &sync.Once{}

// returns the wavesrv main rpc client singleton
func GetMainRpcClient() *wshutil.WshRpc {
	waveSrvClient_Once.Do(func() {
		waveSrvClient_Singleton = wshutil.MakeWshRpc(wshrpc.RpcContext{}, &WshServerImpl, "main-client")
	})
	return waveSrvClient_Singleton
}
