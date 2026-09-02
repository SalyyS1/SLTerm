// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package waveserver

import (
	"context"
	"fmt"
	"log"
	"os"

	"runtime"
	"sync"
	"time"

	"github.com/SalyyS1/SLTerm/pkg/authkey"
	"github.com/SalyyS1/SLTerm/pkg/blockcontroller"
	"github.com/SalyyS1/SLTerm/pkg/blocklogger"
	"github.com/SalyyS1/SLTerm/pkg/filebackup"
	"github.com/SalyyS1/SLTerm/pkg/filestore"
	"github.com/SalyyS1/SLTerm/pkg/jobcontroller"
	"github.com/SalyyS1/SLTerm/pkg/panichandler"
	"github.com/SalyyS1/SLTerm/pkg/petengine"
	"github.com/SalyyS1/SLTerm/pkg/remote/conncontroller"
	"github.com/SalyyS1/SLTerm/pkg/remote/fileshare/wshfs"
	"github.com/SalyyS1/SLTerm/pkg/secretstore"
	"github.com/SalyyS1/SLTerm/pkg/service"
	"github.com/SalyyS1/SLTerm/pkg/telemetry"
	"github.com/SalyyS1/SLTerm/pkg/telemetry/telemetrydata"
	"github.com/SalyyS1/SLTerm/pkg/util/envutil"
	"github.com/SalyyS1/SLTerm/pkg/util/shellutil"
	"github.com/SalyyS1/SLTerm/pkg/util/sigutil"
	"github.com/SalyyS1/SLTerm/pkg/util/utilfn"
	"github.com/SalyyS1/SLTerm/pkg/wavebase"
	"github.com/SalyyS1/SLTerm/pkg/waveobj"
	"github.com/SalyyS1/SLTerm/pkg/wconfig"
	"github.com/SalyyS1/SLTerm/pkg/wcore"
	"github.com/SalyyS1/SLTerm/pkg/web"
	"github.com/SalyyS1/SLTerm/pkg/wps"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc/wshclient"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc/wshremote"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc/wshserver"
	"github.com/SalyyS1/SLTerm/pkg/wshutil"
	"github.com/SalyyS1/SLTerm/pkg/wslconn"
	"github.com/SalyyS1/SLTerm/pkg/wstore"
	"github.com/joho/godotenv"
	"golang.org/x/sync/errgroup"

	"net/http"
	_ "net/http/pprof"
)

// these are set by the caller, from its own build-time values
var WaveVersion = "0.0.0"
var BuildTime = "0"

// Options is what the process knows and this package cannot work out for itself.
type Options struct {
	// Version and BuildTime are the caller's build stamps. They end up in
	// wavebase and in telemetry, and the startup handshake reports them.
	Version   string
	BuildTime string
	// WatchStdin shuts the server down when stdin closes. That is the contract
	// with a supervising parent process that spawns this as a child; it is wrong
	// for a host that runs the server in-process, where stdin belongs to the host.
	WatchStdin bool
}

// Addrs are the listeners a client needs to reach the server.
type Addrs struct {
	Web string
	Ws  string
}

const InitialTelemetryWait = 10 * time.Second
const TelemetryTick = 2 * time.Minute
const TelemetryInterval = 4 * time.Hour
const TelemetryInitialCountsWait = 5 * time.Second
const TelemetryCountsInterval = 1 * time.Hour
const BackupCleanupTick = 2 * time.Minute
const BackupCleanupInterval = 4 * time.Hour

var shutdownOnce sync.Once

// heldLock is the single-instance lock, held for the life of the process.
var heldLock wavebase.FDLock

func doShutdown(reason string) {
	shutdownOnce.Do(func() {
		log.Printf("shutting down: %s\n", reason)
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		go blockcontroller.StopAllBlockControllersForShutdown()
		petengine.Shutdown()
		shutdownActivityUpdate()
		sendTelemetryWrapper()
		// TODO deal with flush in progress
		clearTempFiles()
		filestore.WFS.FlushCache(ctx)
		watcher := wconfig.GetWatcher()
		if watcher != nil {
			watcher.Close()
		}
		time.Sleep(500 * time.Millisecond)
		log.Printf("shutdown complete\n")
		os.Exit(0)
	})
}

// watch stdin, kill server if stdin is closed
func stdinReadWatch() {
	defer func() {
		panichandler.PanicHandler("stdinReadWatch", recover())
	}()
	buf := make([]byte, 1024)
	for {
		_, err := os.Stdin.Read(buf)
		if err != nil {
			doShutdown(fmt.Sprintf("stdin closed/error (%v)", err))
			break
		}
	}
}

func startConfigWatcher() {
	watcher := wconfig.GetWatcher()
	if watcher != nil {
		watcher.Start()
	}
}

func telemetryLoop() {
	defer func() {
		panichandler.PanicHandler("telemetryLoop", recover())
	}()
	var nextSend int64
	time.Sleep(InitialTelemetryWait)
	for {
		if time.Now().Unix() > nextSend {
			nextSend = time.Now().Add(TelemetryInterval).Unix()
			sendTelemetryWrapper()
		}
		time.Sleep(TelemetryTick)
	}
}

func setupTelemetryConfigHandler() {
	watcher := wconfig.GetWatcher()
	if watcher == nil {
		return
	}
	currentConfig := watcher.GetFullConfig()
	currentTelemetryEnabled := currentConfig.Settings.TelemetryEnabled

	watcher.RegisterUpdateHandler(func(newConfig wconfig.FullConfigType) {
		newTelemetryEnabled := newConfig.Settings.TelemetryEnabled
		if newTelemetryEnabled != currentTelemetryEnabled {
			currentTelemetryEnabled = newTelemetryEnabled
		}
	})
}

func backupCleanupLoop() {
	defer func() {
		panichandler.PanicHandler("backupCleanupLoop", recover())
	}()
	var nextCleanup int64
	for {
		if time.Now().Unix() > nextCleanup {
			nextCleanup = time.Now().Add(BackupCleanupInterval).Unix()
			err := filebackup.CleanupOldBackups()
			if err != nil {
				log.Printf("error cleaning up old backups: %v\n", err)
			}
		}
		time.Sleep(BackupCleanupTick)
	}
}

func panicTelemetryHandler(panicName string) {
	activity := wshrpc.ActivityUpdate{NumPanics: 1}
	err := telemetry.UpdateActivity(context.Background(), activity)
	if err != nil {
		log.Printf("error updating activity (panicTelemetryHandler): %v\n", err)
	}
	telemetry.RecordTEvent(context.Background(), telemetrydata.MakeTEvent("debug:panic", telemetrydata.TEventProps{
		PanicType: panicName,
	}))
}

func sendTelemetryWrapper() {
	defer func() {
		panichandler.PanicHandler("sendTelemetryWrapper", recover())
	}()
	ctx, cancelFn := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelFn()
	beforeSendActivityUpdate(ctx)
}

func updateTelemetryCounts(lastCounts telemetrydata.TEventProps) telemetrydata.TEventProps {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	var props telemetrydata.TEventProps
	props.CountBlocks, _ = wstore.DBGetCount[*waveobj.Block](ctx)
	props.CountTabs, _ = wstore.DBGetCount[*waveobj.Tab](ctx)
	props.CountWindows, _ = wstore.DBGetCount[*waveobj.Window](ctx)
	props.CountWorkspaces, _, _ = wstore.DBGetWSCounts(ctx)
	props.CountSSHConn = conncontroller.GetNumSSHHasConnected()
	props.CountWSLConn = wslconn.GetNumWSLHasConnected()
	props.CountJobs = jobcontroller.GetNumJobsRunning()
	props.CountJobsConnected = jobcontroller.GetNumJobsConnected()
	props.CountViews, _ = wstore.DBGetBlockViewCounts(ctx)

	fullConfig := wconfig.GetWatcher().GetFullConfig()
	customWidgets := fullConfig.CountCustomWidgets()
	customAIPresets := fullConfig.CountCustomAIPresets()
	customSettings := wconfig.CountCustomSettings()
	customAIModes := fullConfig.CountCustomAIModes()

	props.UserSet = &telemetrydata.TEventUserProps{
		SettingsCustomWidgets:   customWidgets,
		SettingsCustomAIPresets: customAIPresets,
		SettingsCustomSettings:  customSettings,
		SettingsCustomAIModes:   customAIModes,
	}

	secretsCount, err := secretstore.CountSecrets()
	if err == nil {
		props.UserSet.SettingsSecretsCount = secretsCount
	}

	if utilfn.CompareAsMarshaledJson(props, lastCounts) {
		return lastCounts
	}
	tevent := telemetrydata.MakeTEvent("app:counts", props)
	err = telemetry.RecordTEvent(ctx, tevent)
	if err != nil {
		log.Printf("error recording counts tevent: %v\n", err)
	}
	return props
}

func updateTelemetryCountsLoop() {
	defer func() {
		panichandler.PanicHandler("updateTelemetryCountsLoop", recover())
	}()
	var nextSend int64
	var lastCounts telemetrydata.TEventProps
	time.Sleep(TelemetryInitialCountsWait)
	for {
		if time.Now().Unix() > nextSend {
			nextSend = time.Now().Add(TelemetryCountsInterval).Unix()
			lastCounts = updateTelemetryCounts(lastCounts)
		}
		time.Sleep(TelemetryTick)
	}
}

func beforeSendActivityUpdate(ctx context.Context) {
	activity := wshrpc.ActivityUpdate{}
	activity.NumTabs, _ = wstore.DBGetCount[*waveobj.Tab](ctx)
	activity.NumBlocks, _ = wstore.DBGetCount[*waveobj.Block](ctx)
	activity.Blocks, _ = wstore.DBGetBlockViewCounts(ctx)
	activity.NumWindows, _ = wstore.DBGetCount[*waveobj.Window](ctx)
	activity.NumSSHConn = conncontroller.GetNumSSHHasConnected()
	activity.NumWSLConn = wslconn.GetNumWSLHasConnected()
	activity.NumWSNamed, activity.NumWS, _ = wstore.DBGetWSCounts(ctx)
	err := telemetry.UpdateActivity(ctx, activity)
	if err != nil {
		log.Printf("error updating before activity: %v\n", err)
	}
}

func startupActivityUpdate(firstLaunch bool) {
	defer func() {
		panichandler.PanicHandler("startupActivityUpdate", recover())
	}()
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	activity := wshrpc.ActivityUpdate{Startup: 1}
	err := telemetry.UpdateActivity(ctx, activity) // set at least one record into activity (don't use go routine wrap here)
	if err != nil {
		log.Printf("error updating startup activity: %v\n", err)
	}
	autoUpdateChannel := telemetry.AutoUpdateChannel()
	autoUpdateEnabled := telemetry.IsAutoUpdateEnabled()
	shellType, shellVersion, shellErr := shellutil.DetectShellTypeAndVersion()
	if shellErr != nil {
		shellType = "error"
		shellVersion = ""
	}
	userSetOnce := &telemetrydata.TEventUserProps{
		ClientInitialVersion: "v" + WaveVersion,
	}
	tosTs := telemetry.GetTosAgreedTs()
	var cohortTime time.Time
	if tosTs > 0 {
		cohortTime = time.UnixMilli(tosTs)
	} else {
		cohortTime = time.Now()
	}
	cohortMonth := cohortTime.Format("2006-01")
	year, week := cohortTime.ISOWeek()
	cohortISOWeek := fmt.Sprintf("%04d-W%02d", year, week)
	userSetOnce.CohortMonth = cohortMonth
	userSetOnce.CohortISOWeek = cohortISOWeek
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	props := telemetrydata.TEventProps{
		UserSet: &telemetrydata.TEventUserProps{
			ClientVersion:       "v" + wavebase.WaveVersion,
			ClientBuildTime:     wavebase.BuildTime,
			ClientArch:          wavebase.ClientArch(),
			ClientOSRelease:     wavebase.UnameKernelRelease(),
			ClientIsDev:         wavebase.IsDevMode(),
			AutoUpdateChannel:   autoUpdateChannel,
			AutoUpdateEnabled:   autoUpdateEnabled,
			LocalShellType:      shellType,
			LocalShellVersion:   shellVersion,
			SettingsTransparent: fullConfig.Settings.WindowTransparent,
		},
		UserSetOnce: userSetOnce,
	}
	if firstLaunch {
		props.AppFirstLaunch = true
	}
	tevent := telemetrydata.MakeTEvent("app:startup", props)
	err = telemetry.RecordTEvent(ctx, tevent)
	if err != nil {
		log.Printf("error recording startup event: %v\n", err)
	}
}

func shutdownActivityUpdate() {
	ctx, cancelFn := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancelFn()
	activity := wshrpc.ActivityUpdate{Shutdown: 1}
	err := telemetry.UpdateActivity(ctx, activity) // do NOT use the go routine wrap here (this needs to be synchronous)
	if err != nil {
		log.Printf("error updating shutdown activity: %v\n", err)
	}
	err = telemetry.TruncateActivityTEventForShutdown(ctx)
	if err != nil {
		log.Printf("error truncating activity t-event for shutdown: %v\n", err)
	}
	tevent := telemetrydata.MakeTEvent("app:shutdown", telemetrydata.TEventProps{})
	err = telemetry.RecordTEvent(ctx, tevent)
	if err != nil {
		log.Printf("error recording shutdown event: %v\n", err)
	}
}

func createMainWshClient() {
	rpc := wshserver.GetMainRpcClient()
	wshfs.RpcClient = rpc
	wshutil.DefaultRouter.RegisterTrustedLeaf(rpc, wshutil.DefaultRoute)
	wps.Broker.SetClient(wshutil.DefaultRouter)
	localInitialEnv := envutil.PruneInitialEnv(envutil.SliceToMap(os.Environ()))
	sockName := wavebase.GetDomainSocketName()
	remoteImpl := wshremote.MakeRemoteRpcServerImpl(nil, wshutil.DefaultRouter, wshclient.GetBareRpcClient(), true, localInitialEnv, sockName)
	localConnWsh := wshutil.MakeWshRpc(wshrpc.RpcContext{Conn: wshrpc.LocalConnName}, remoteImpl, "conn:local")
	go wshremote.RunSysInfoLoop(localConnWsh, wshrpc.LocalConnName)
	wshutil.DefaultRouter.RegisterTrustedLeaf(localConnWsh, wshutil.MakeConnectionRouteId(wshrpc.LocalConnName))
}

func grabAndRemoveEnvVars() error {
	err := authkey.SetAuthKeyFromEnv()
	if err != nil {
		return fmt.Errorf("setting auth key: %v", err)
	}
	err = wavebase.CacheAndRemoveEnvVars()
	if err != nil {
		return err
	}

	// Remove SLTERM env vars that leak from prod => dev
	os.Unsetenv("SLTERM_CLIENTID")
	os.Unsetenv("SLTERM_WORKSPACEID")
	os.Unsetenv("SLTERM_TABID")
	os.Unsetenv("SLTERM_BLOCKID")
	os.Unsetenv("SLTERM_CONN")
	os.Unsetenv("SLTERM_JWT")
	os.Unsetenv("SLTERM_VERSION")

	return nil
}

func clearTempFiles() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client: %v", err)
	}
	filestore.WFS.DeleteZone(ctx, client.TempOID)
	return nil
}

func maybeStartPprofServer() {
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	if settings.DebugPprofMemProfileRate != nil {
		runtime.MemProfileRate = *settings.DebugPprofMemProfileRate
		log.Printf("set runtime.MemProfileRate to %d\n", runtime.MemProfileRate)
	}
	if settings.DebugPprofPort == nil {
		return
	}
	pprofPort := *settings.DebugPprofPort
	if pprofPort < 1 || pprofPort > 65535 {
		log.Printf("[error] debug:pprofport must be between 1 and 65535, got %d\n", pprofPort)
		return
	}
	go func() {
		addr := fmt.Sprintf("localhost:%d", pprofPort)
		log.Printf("starting pprof server on %s\n", addr)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Printf("[error] pprof server failed: %v\n", err)
		}
	}()
}

// Start brings up the whole backend and returns the addresses it listens on.
//
// The web server runs in the background rather than blocking, so a caller can be
// something other than a `main` with nothing else to do — an in-process host, or a
// test. Shutdown still goes through the signal handlers installed here, and those
// end the process, so a caller that only wants the server running can simply block.
func Start(opts Options) (Addrs, error) {
	WaveVersion = opts.Version
	BuildTime = opts.BuildTime
	if envFilePath := os.Getenv("SLTERM_ENVFILE"); envFilePath != "" {
		log.Printf("applying env file: %s\n", envFilePath)
		_ = godotenv.Load(envFilePath)
	}

	wavebase.WaveVersion = WaveVersion
	wavebase.BuildTime = BuildTime
	wshutil.DefaultRouter = wshutil.NewWshRouter()
	wshutil.DefaultRouter.SetAsRootRouter()

	err := grabAndRemoveEnvVars()
	if err != nil {
		return Addrs{}, err
	}
	err = service.ValidateServiceMap()
	if err != nil {
		return Addrs{}, fmt.Errorf("validating service map: %w", err)
	}
	err = wavebase.EnsureWaveDataDir()
	if err != nil {
		return Addrs{}, fmt.Errorf("ensuring wave home dir: %w", err)
	}
	err = wavebase.EnsureWaveDBDir()
	if err != nil {
		return Addrs{}, fmt.Errorf("ensuring wave db dir: %w", err)
	}
	err = wavebase.EnsureWaveConfigDir()
	if err != nil {
		return Addrs{}, fmt.Errorf("ensuring wave config dir: %w", err)
	}

	// TODO: rather than ensure this dir exists, we should let the editor recursively create parent dirs on save
	err = wavebase.EnsureWavePresetsDir()
	if err != nil {
		return Addrs{}, fmt.Errorf("ensuring wave presets dir: %w", err)
	}
	err = wavebase.EnsureWaveCachesDir()
	if err != nil {
		return Addrs{}, fmt.Errorf("ensuring wave caches dir: %w", err)
	}
	waveLock, err := wavebase.AcquireWaveLock()
	if err != nil {
		return Addrs{}, fmt.Errorf("acquiring wave lock (another instance is likely running): %w", err)
	}
	// The lock is held for the life of the process. Shutdown goes through
	// doShutdown, which exits, so there is no orderly release to schedule — but a
	// failure on the way up has to hand it back, or a caller that recovers from the
	// error can never start a server again.
	heldLock = waveLock
	releaseLockOnFailure := func() {
		if closeErr := waveLock.Close(); closeErr != nil {
			log.Printf("error releasing wave lock: %v\n", closeErr)
		}
		heldLock = nil
	}
	log.Printf("wave version: %s (%s)\n", WaveVersion, BuildTime)
	log.Printf("wave data dir: %s\n", wavebase.GetWaveDataDir())
	log.Printf("wave config dir: %s\n", wavebase.GetWaveConfigDir())
	// Parallelize filestore + wstore init (separate SQLite databases: filestore.db / slterm.db)
	var g errgroup.Group
	g.Go(func() error {
		return filestore.InitFilestore()
	})
	g.Go(func() error {
		return wstore.InitWStore()
	})
	if err = g.Wait(); err != nil {
		releaseLockOnFailure()
		return Addrs{}, fmt.Errorf("initializing stores: %w", err)
	}
	panichandler.PanicTelemetryHandler = panicTelemetryHandler
	go func() {
		defer func() {
			panichandler.PanicHandler("InitCustomShellStartupFiles", recover())
		}()
		err := shellutil.InitCustomShellStartupFiles()
		if err != nil {
			log.Printf("error initializing wsh and shell-integration files: %v\n", err)
		}
	}()
	firstLaunch, err := wcore.EnsureInitialData()
	if err != nil {
		releaseLockOnFailure()
		return Addrs{}, fmt.Errorf("ensuring initial data: %w", err)
	}
	if firstLaunch {
		log.Printf("first launch detected")
	}
	err = clearTempFiles()
	if err != nil {
		releaseLockOnFailure()
		return Addrs{}, fmt.Errorf("clearing temp files: %w", err)
	}
	err = wcore.InitMainServer()
	if err != nil {
		releaseLockOnFailure()
		return Addrs{}, fmt.Errorf("initializing mainserver: %w", err)
	}

	err = shellutil.FixupWaveZshHistory()
	if err != nil {
		log.Printf("error fixing up wave zsh history: %v\n", err)
	}
	createMainWshClient()
	sigutil.InstallShutdownSignalHandlers(doShutdown)
	sigutil.InstallSIGUSR1Handler()
	startConfigWatcher()
	maybeStartPprofServer()
	if opts.WatchStdin {
		go stdinReadWatch()
	}
	go telemetryLoop()
	setupTelemetryConfigHandler()
	go updateTelemetryCountsLoop()
	go backupCleanupLoop()
	go startupActivityUpdate(firstLaunch) // must be after startConfigWatcher()
	blocklogger.InitBlockLogger()
	jobcontroller.InitJobController()
	blockcontroller.InitBlockController()
	wcore.InitTabIndicatorStore()
	petengine.Init()
	log.Printf("pet engine initialized")
	go func() {
		defer func() {
			panichandler.PanicHandler("GetSystemSummary", recover())
		}()
		wavebase.GetSystemSummary()
	}()

	webListener, err := web.MakeTCPListener("web")
	if err != nil {
		releaseLockOnFailure()
		return Addrs{}, fmt.Errorf("creating web listener: %w", err)
	}
	wsListener, err := web.MakeTCPListener("websocket")
	if err != nil {
		releaseLockOnFailure()
		return Addrs{}, fmt.Errorf("creating websocket listener: %w", err)
	}
	go web.RunWebSocketServer(wsListener)
	unixListener, err := web.MakeUnixListener()
	if err != nil {
		releaseLockOnFailure()
		return Addrs{}, fmt.Errorf("creating unix listener: %w", err)
	}
	go wshutil.RunWshRpcOverListener(unixListener, nil)
	// Runs in the background so Start can hand the addresses back. Nothing else
	// stops the process, so if this returns the server is finished.
	go func() {
		defer func() {
			panichandler.PanicHandler("RunWebServer", recover())
		}()
		web.RunWebServer(webListener)
		log.Printf("web server stopped\n")
	}()
	return Addrs{Web: webListener.Addr().String(), Ws: wsListener.Addr().String()}, nil
}
