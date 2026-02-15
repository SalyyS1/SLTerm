// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package userinputservice

import (
	"github.com/SalyyS1/SLTerm/pkg/userinput"
)

type UserInputService struct {
}

func (uis *UserInputService) SendUserInputResponse(response *userinput.UserInputResponse) {
	select {
	case userinput.MainUserInputHandler.Channels[response.RequestId] <- response:
	default:
	}
}
