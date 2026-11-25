import { useSteel } from "./store";
import { policyFor, probeSignal } from "@/lib/signal/probe";
import { requestWithTimeoutAndLateCleanup } from "./media-permission";

type WorkletHandle = {
  ctx: AudioContext;
  node: AudioWorkletNode;
  master: GainNode;
  dest: MediaStreamAudioDestinationNode;
  mic: MediaStreamAudioSourceNode | null;
  stream: MediaStream | null;
  destOn: boolean;
};

let handle: WorkletHandle | null = null;

function addonFlag(id: string) {
  return useSteel.getState().addons[id] ? 1 : 0;
}

export function currentParams() {
  const s = useSteel.getState();
  return {
    inGain: s.inGain,
    outGain: s.outGain,
    master: s.master,
    hpf: addonFlag("hpf"),
    hpHz: s.hpHz,
    eqLo: s.eqLo,
    eqMid: s.eqMid,
    eqHi: s.eqHi,
    sat: addonFlag("sat"),
    satAmt: s.satAmt,
    comp: addonFlag("comp"),
    thresh: s.thresh,
    limit: addonFlag("limit"),
    synth: addonFlag("synth"),
    transient: addonFlag("transient"),
    transAmt: s.transAmt,
  };
}

export function pushParams() {
  handle?.node.port.postMessage({ type: "params", params: currentParams() });
}

export function sendNote(on: boolean, note: number, vel = 0.8) {
  handle?.node.port.postMessage({ type: on ? "noteOn" : "noteOff", note, vel });
}

export async function playNote(on: boolean, note: number, vel = 0.85) {
  if (!useSteel.getState().armed) {
    if (!on) return;
    try {
      await armKernel();
    } catch {
      return;
    }
    if (!useSteel.getState().armed) return;
  }
  sendNote(on, note, vel);
}

export function panic() {
  handle?.node.port.postMessage({ type: "panic" });
}

export function getWebStream() {
  return handle?.dest.stream ?? null;
}

export function setWebTap(on: boolean) {
  if (!handle) {
    useSteel.getState().patch({ webOut: on });
    return;
  }
  if (on && !handle.destOn) {
    handle.master.connect(handle.dest);
    handle.destOn = true;
  } else if (!on && handle.destOn) {
    try {
      handle.master.disconnect(handle.dest);
    } catch {
      /* already disconnected */
    }
    handle.destOn = false;
  }
  useSteel.getState().patch({ webOut: on });
}

async function tryMic(ctx: AudioContext, node: AudioWorkletNode) {
  if (!navigator.mediaDevices?.getUserMedia) return { mic: null, stream: null };
  try {
    const stream = await requestWithTimeoutAndLateCleanup(
      () =>
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
        }),
      (lateStream) => lateStream.getTracks().forEach((track) => track.stop()),
      900,
    );
    const mic = ctx.createMediaStreamSource(stream);
    mic.connect(node);
    return { mic, stream };
  } catch {
    return { mic: null, stream: null };
  }
}

let lifecycleQueue: Promise<void> = Promise.resolve();

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const task = lifecycleQueue.then(operation, operation);
  lifecycleQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function armKernelInternal() {
  const { sampleRate, kernel, webOut, patch } = useSteel.getState();
  if (handle) await disarmKernelInternal();

  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let master: GainNode | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let mic: MediaStreamAudioSourceNode | null = null;
  let stream: MediaStream | null = null;

  try {
    const hint = policyFor(probeSignal().path).latencyHint;
    ctx = new AudioContext({ sampleRate, latencyHint: hint });
    await ctx.audioWorklet.addModule(
      `/worklets/steel-kernel.js?k=${encodeURIComponent(kernel)}`,
    );
    node = new AudioWorkletNode(ctx, "steel-kernel", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    master = ctx.createGain();
    master.gain.value = 1;
    dest = ctx.createMediaStreamDestination();
    node.connect(master);
    master.connect(ctx.destination);
    if (webOut) master.connect(dest);

    node.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; peak?: number; rms?: number; voices?: number };
      if (data?.type !== "meter") return;
      useSteel.getState().patch({
        peak: data.peak ?? 0,
        rms: data.rms ?? 0,
        voices: data.voices ?? 0,
      });
    };

    const micResult = await tryMic(ctx, node);
    mic = micResult.mic;
    stream = micResult.stream;

    node.port.postMessage({ type: "params", params: currentParams() });
    await ctx.resume();

    handle = { ctx, node, master, dest, mic, stream, destOn: webOut };
    patch({
      armed: true,
      running: ctx.state === "running",
      error: null,
      inputLive: Boolean(stream),
    });
  } catch (error) {
    // Each cleanup is isolated so one teardown failure cannot skip the rest.
    try { if (node) node.port.onmessage = null; } catch { /* best effort */ }
    try { node?.disconnect(); } catch { /* best effort */ }
    try { master?.disconnect(); } catch { /* best effort */ }
    try { mic?.disconnect(); } catch { /* best effort */ }
    try { stream?.getTracks().forEach((track) => track.stop()); } catch { /* best effort */ }
    try { if (ctx && ctx.state !== "closed") await ctx.close(); } catch { /* best effort */ }
    handle = null;
    useSteel.getState().patch({
      armed: false,
      running: false,
      inputLive: false,
      error: error instanceof Error ? error.message : "Audio engine startup failed.",
    });
    throw error;
  }
}

async function disarmKernelInternal() {
  const active = handle;
  handle = null;
  if (!active) {
    useSteel.getState().patch({ armed: false, running: false, inputLive: false });
    return;
  }

  try { active.node.port.onmessage = null; } catch { /* best effort */ }
  try { active.node.disconnect(); } catch { /* best effort */ }
  try { active.master.disconnect(); } catch { /* best effort */ }
  try { active.mic?.disconnect(); } catch { /* best effort */ }
  try { active.stream?.getTracks().forEach((track) => track.stop()); } catch { /* best effort */ }
  try { if (active.ctx.state !== "closed") await active.ctx.close(); } catch { /* best effort */ }

  useSteel.getState().patch({
    armed: false,
    running: false,
    peak: 0,
    rms: 0,
    voices: 0,
    inputLive: false,
  });
}

export function armKernel() {
  return enqueueLifecycle(armKernelInternal);
}

export function disarmKernel() {
  return enqueueLifecycle(disarmKernelInternal);
}

export function toggleKernel() {
  return enqueueLifecycle(async () => {
    if (useSteel.getState().armed || handle) await disarmKernelInternal();
    else await armKernelInternal();
  });
}

export function tapSteelMaster(): { ctx: AudioContext; master: GainNode } | null {
  if (!handle) return null;
  return { ctx: handle.ctx, master: handle.master };
}

export function browserReportedLatencyMs() {
  if (!handle) return null;
  const { ctx } = handle;
  const base = ctx.baseLatency || 0;
  const out = ctx.outputLatency || 0;
  return (base + out) * 1000;
}
