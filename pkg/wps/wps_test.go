// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package wps

import (
	"sync"
	"testing"
)

type recordingClient struct {
	events []WaveEvent
}

func (c *recordingClient) SendEvent(routeId string, event WaveEvent) {
	c.events = append(c.events, event)
}

func newTestBroker() (*BrokerType, *recordingClient) {
	client := &recordingClient{}
	b := &BrokerType{
		Lock:       &sync.Mutex{},
		SubMap:     make(map[string]*BrokerSubscription),
		PersistMap: make(map[persistKey]*persistEventWrap),
	}
	b.SetClient(client)
	return b, client
}

func TestHasSubscribersNoClient(t *testing.T) {
	b := &BrokerType{
		Lock:       &sync.Mutex{},
		SubMap:     make(map[string]*BrokerSubscription),
		PersistMap: make(map[persistKey]*persistEventWrap),
	}
	b.Subscribe("route1", SubscriptionRequest{Event: Event_BlockFile, AllScopes: true})
	if b.HasSubscribers(Event_BlockFile, []string{"block:b1"}) {
		t.Fatal("expected no subscribers without a client to deliver to")
	}
}

func TestHasSubscribersNoSubscription(t *testing.T) {
	b, _ := newTestBroker()
	if b.HasSubscribers(Event_BlockFile, []string{"block:b1"}) {
		t.Fatal("expected no subscribers for an event nobody subscribed to")
	}
}

func TestHasSubscribersAllScopes(t *testing.T) {
	b, _ := newTestBroker()
	b.Subscribe("route1", SubscriptionRequest{Event: Event_BlockFile, AllScopes: true})
	if !b.HasSubscribers(Event_BlockFile, []string{"block:b1"}) {
		t.Fatal("an all-scopes subscription should match any scope")
	}
	if !b.HasSubscribers(Event_BlockFile, nil) {
		t.Fatal("an all-scopes subscription should match even with no scope given")
	}
}

func TestHasSubscribersExactScope(t *testing.T) {
	b, _ := newTestBroker()
	b.Subscribe("route1", SubscriptionRequest{Event: Event_BlockFile, Scopes: []string{"block:b1"}})
	if !b.HasSubscribers(Event_BlockFile, []string{"block:b1"}) {
		t.Fatal("expected the subscribed scope to match")
	}
	if b.HasSubscribers(Event_BlockFile, []string{"block:b2"}) {
		t.Fatal("expected an unsubscribed scope not to match")
	}
	if b.HasSubscribers("otherevent", []string{"block:b1"}) {
		t.Fatal("expected a different event name not to match")
	}
}

func TestHasSubscribersStarScope(t *testing.T) {
	b, _ := newTestBroker()
	b.Subscribe("route1", SubscriptionRequest{Event: Event_BlockFile, Scopes: []string{"block:*"}})
	if !b.HasSubscribers(Event_BlockFile, []string{"block:b1"}) {
		t.Fatal("expected a star scope to match a concrete scope")
	}
	if b.HasSubscribers(Event_BlockFile, []string{"tab:t1"}) {
		t.Fatal("expected a star scope not to match a different prefix")
	}
}

// HasSubscribers exists so a caller can skip building an expensive payload. It has
// to agree with what Publish actually delivers, or the caller skips work that would
// have been sent.
func TestHasSubscribersAgreesWithPublish(t *testing.T) {
	cases := []struct {
		name  string
		sub   *SubscriptionRequest
		scope string
	}{
		{name: "no subscription", sub: nil, scope: "block:b1"},
		{name: "all scopes", sub: &SubscriptionRequest{Event: Event_BlockFile, AllScopes: true}, scope: "block:b1"},
		{name: "matching scope", sub: &SubscriptionRequest{Event: Event_BlockFile, Scopes: []string{"block:b1"}}, scope: "block:b1"},
		{name: "other scope", sub: &SubscriptionRequest{Event: Event_BlockFile, Scopes: []string{"block:b1"}}, scope: "block:b2"},
		{name: "star scope", sub: &SubscriptionRequest{Event: Event_BlockFile, Scopes: []string{"block:*"}}, scope: "block:b9"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, client := newTestBroker()
			if tc.sub != nil {
				b.Subscribe("route1", *tc.sub)
			}
			predicted := b.HasSubscribers(Event_BlockFile, []string{tc.scope})
			b.Publish(WaveEvent{Event: Event_BlockFile, Scopes: []string{tc.scope}})
			delivered := len(client.events) > 0
			if predicted != delivered {
				t.Fatalf("HasSubscribers said %v but Publish delivered %v", predicted, delivered)
			}
		})
	}
}
