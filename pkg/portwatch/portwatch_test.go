// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package portwatch

import "testing"

func TestParseWindowsNetstatAndTasklist(t *testing.T) {
	tasklist := `"node.exe","4120","Console","1","120,000 K"
"vite.exe","8821","Console","1","85,000 K"
"svchost.exe","900","Services","0","20,000 K"
`
	pids := ParseWindowsTasklistCSV(tasklist)
	if pids[4120] != "node.exe" || pids[8821] != "vite.exe" {
		t.Fatalf("unexpected tasklist map: %+v", pids)
	}

	netstat := `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       8821
  TCP    [::1]:3000             [::]:0                 LISTENING       4120
  TCP    127.0.0.1:5173         127.0.0.1:55122        ESTABLISHED     8821
`
	ports := ParseWindowsNetstat(netstat, pids)
	if len(ports) != 3 {
		t.Fatalf("expected 3 listening ports, got %+v", ports)
	}
	// Dev ports (3000, 5173) must sort before system port 135.
	if ports[0].Port != 3000 || ports[0].Process != "node.exe" || !ports[0].IsDevLikely {
		t.Fatalf("expected port 3000 dev first, got %+v", ports[0])
	}
	if ports[1].Port != 5173 || ports[1].Process != "vite.exe" || ports[1].URL != "http://127.0.0.1:5173" {
		t.Fatalf("expected port 5173 second, got %+v", ports[1])
	}
	if ports[2].Port != 135 || ports[2].IsDevLikely {
		t.Fatalf("expected port 135 non-dev last, got %+v", ports[2])
	}
}

func TestParseLinuxSS(t *testing.T) {
	ssOut := `State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0      511    127.0.0.1:8080     0.0.0.0:*         users:(("go-server",pid=2234,fd=7))
LISTEN 0      128    [::]:22            [::]:*            users:(("sshd",pid=512,fd=3))
`
	ports := ParseLinuxSS(ssOut)
	if len(ports) != 2 {
		t.Fatalf("expected 2 ports, got %+v", ports)
	}
	if ports[0].Port != 8080 || ports[0].Process != "go-server" || ports[0].PID != 2234 || !ports[0].IsDevLikely {
		t.Fatalf("unexpected first ss port: %+v", ports[0])
	}
	if ports[1].Port != 22 || ports[1].IsDevLikely {
		t.Fatalf("unexpected second ss port: %+v", ports[1])
	}
}

func TestValidateKillTargetGuards(t *testing.T) {
	ports := []ListeningPort{
		{Port: 5173, PID: 8821, Process: "node.exe", IsDevLikely: true},
		{Port: 135, PID: 900, Process: "svchost.exe", IsDevLikely: false},
	}
	if _, err := ValidateKillTarget(ports, 135, 900, 1234); err == nil {
		t.Fatal("expected non-dev system port 135 to be rejected")
	}
	if _, err := ValidateKillTarget(ports, 5173, 1234, 1234); err == nil {
		t.Fatal("expected self PID to be rejected")
	}
	if _, err := ValidateKillTarget(ports, 5173, 4, 1234); err == nil {
		t.Fatal("expected protected PID <= 4 to be rejected")
	}
	if _, err := ValidateKillTarget(ports, 5173, 9999, 1234); err == nil {
		t.Fatal("expected mismatched PID to be rejected")
	}
	got, err := ValidateKillTarget(ports, 5173, 8821, 1234)
	if err != nil || got.PID != 8821 || got.Port != 5173 {
		t.Fatalf("expected valid dev port kill target, got %+v err=%v", got, err)
	}
}
