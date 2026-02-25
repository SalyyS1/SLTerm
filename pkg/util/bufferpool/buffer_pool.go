// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package bufferpool provides tiered sync.Pool byte buffer pools to reduce GC pressure
// in high-throughput paths (PTY output reading, WebSocket writes, stream management).
// Three tiers: 4KB (small reads), 32KB (medium I/O), 256KB (large data transfers).
package bufferpool

import "sync"

var (
	// pool4K serves buffers up to 4KB — typical PTY read loop size
	pool4K = sync.Pool{
		New: func() interface{} { return make([]byte, 0, 4096) },
	}
	// pool32K serves buffers up to 32KB — stream packets and WS frames
	pool32K = sync.Pool{
		New: func() interface{} { return make([]byte, 0, 32768) },
	}
	// pool256K serves buffers up to 256KB — large data transfers
	pool256K = sync.Pool{
		New: func() interface{} { return make([]byte, 0, 262144) },
	}
)

// Get returns a zero-length byte slice with capacity >= size from the appropriate tier pool.
// The returned slice has length 0 and must be used with append or resliced.
// Caller MUST call Put when done to return the buffer.
func Get(size int) []byte {
	switch {
	case size <= 4096:
		return pool4K.Get().([]byte)[:0]
	case size <= 32768:
		return pool32K.Get().([]byte)[:0]
	default:
		return pool256K.Get().([]byte)[:0]
	}
}

// GetLen returns a byte slice with length == size (not just capacity).
// Useful for fixed-size read buffers (e.g. reader.Read(buf)).
// Caller MUST call Put when done.
func GetLen(size int) []byte {
	buf := Get(size)
	buf = buf[:size]
	return buf
}

// Put returns a buffer to the appropriate pool tier based on its capacity.
// Buffers larger than 256KB are discarded (let GC handle oversized allocations).
// Always zero-lengths the slice before returning so next Get starts clean.
func Put(buf []byte) {
	c := cap(buf)
	switch {
	case c <= 4096:
		pool4K.Put(buf[:0])
	case c <= 32768:
		pool32K.Put(buf[:0])
	case c <= 262144:
		pool256K.Put(buf[:0])
	// oversized: let GC collect it — don't pollute the pool
	}
}
