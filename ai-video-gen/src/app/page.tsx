"use client";

import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type LayerSpec = {
  color: string;
  radius: number;
  rotation: number;
  speed: number;
  variance: number;
};

type SparkSpec = {
  angle: number;
  distance: number;
  size: number;
  drift: number;
  hueShift: number;
};

type SceneBlueprint = {
  layers: LayerSpec[];
  sparks: SparkSpec[];
  background: [string, string];
  pulse: number;
  distort: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const hashString = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const createRng = (seed: number) => {
  let state = seed || 1;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
};

const buildScene = (prompt: string): SceneBlueprint => {
  const baseHash = hashString(prompt.trim().toLowerCase() || "sora");
  const rng = createRng(baseHash);

  const hue = (baseHash % 360) / 360;
  const accent = clamp(((baseHash >> 8) % 360) / 360, 0, 1);
  const background: [string, string] = [
    `hsl(${Math.floor(hue * 360)}, 68%, 12%)`,
    `hsl(${Math.floor(((hue + accent / 3) % 1) * 360)}, 80%, 22%)`,
  ];

  const layerCount = 5 + Math.floor(rng() * 5);
  const layers: LayerSpec[] = Array.from({ length: layerCount }).map((_, index) => {
    const layerHue = (hue + rng() * 0.25 - 0.125 + index * 0.03) % 1;
    return {
      color: `hsla(${Math.floor(layerHue * 360)}, ${60 + Math.floor(rng() * 30)}%, ${45 + Math.floor(rng() * 20)}%, ${0.35 + rng() * 0.35})`,
      radius: 0.25 + rng() * 0.65,
      rotation: rng() * Math.PI * 2,
      speed: 0.2 + rng() * 0.9,
      variance: 0.2 + rng() * 0.6,
    };
  });

  const sparkCount = 120 + Math.floor(rng() * 180);
  const sparks: SparkSpec[] = Array.from({ length: sparkCount }).map(() => ({
    angle: rng() * Math.PI * 2,
    distance: 0.1 + rng() * 0.9,
    size: 1 + rng() * 2,
    drift: 0.5 + rng() * 1.5,
    hueShift: (rng() - 0.5) * 40,
  }));

  return {
    layers,
    sparks,
    background,
    pulse: 0.4 + rng() * 0.4,
    distort: 0.5 + rng() * 0.9,
  };
};

const drawScene = (ctx: CanvasRenderingContext2D, time: number, blueprint: SceneBlueprint) => {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, blueprint.background[0]);
  gradient.addColorStop(1, blueprint.background[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const maxDim = Math.max(width, height);
  const pulse = 1 + Math.sin(time * blueprint.pulse) * 0.05;

  blueprint.layers.forEach((layer, index) => {
    const layerTime = time * layer.speed + layer.rotation;
    const radius = (maxDim * layer.radius * pulse) / 2;
    const points = 360;
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const angle = (i / points) * Math.PI * 2;
      const distortion = Math.sin(angle * (2 + index) + layerTime) * layer.variance;
      const x = cx + Math.cos(angle + layerTime * 0.25) * radius * (1 + distortion * blueprint.distort * 0.4);
      const y = cy + Math.sin(angle + layerTime * 0.25) * radius * (1 + distortion * blueprint.distort * 0.4);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = layer.color;
    ctx.filter = `blur(${3 + index * 1.5}px)`;
    ctx.fill();
  });

  ctx.filter = "none";
  ctx.globalCompositeOperation = "lighter";
  blueprint.sparks.forEach((spark, idx) => {
    const sparkTime = time * spark.drift + idx * 0.01;
    const angle = spark.angle + Math.sin(sparkTime * 0.5) * 0.5;
    const distance = spark.distance + Math.sin(sparkTime) * 0.02;
    const x = cx + Math.cos(angle) * distance * maxDim * 0.45;
    const y = cy + Math.sin(angle) * distance * maxDim * 0.45;
    const gradientSpark = ctx.createRadialGradient(x, y, 0, x, y, spark.size * 12);
    gradientSpark.addColorStop(0, `hsla(${spark.hueShift + time * 40}, 80%, 70%, 0.85)`);
    gradientSpark.addColorStop(1, "hsla(0, 0%, 100%, 0)");
    ctx.fillStyle = gradientSpark;
    ctx.beginPath();
    ctx.arc(x, y, spark.size * 12, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalCompositeOperation = "source-over";
};

const preferredMimeType = () => {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
};

const fpsOptions = [12, 24, 30];

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [prompt, setPrompt] = useState("dreamlike neon cityscape with floating koi fish and aurora sky");
  const [fps, setFps] = useState<number>(24);
  const [duration, setDuration] = useState<number>(6);
  const [resolution, setResolution] = useState<number>(768);
  const [status, setStatus] = useState<string>("idle");
  const [progress, setProgress] = useState<number>(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blueprint = useMemo(() => buildScene(prompt), [prompt]);
  const downloadName = useMemo(() => {
    if (!videoUrl) {
      return undefined;
    }
    const slug = prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40);
    return `sora2-procedural-${slug || "sequence"}.webm`;
  }, [prompt, videoUrl]);

  const stopAnimation = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const renderLoop = useCallback(
    (ctx: CanvasRenderingContext2D, start: number, lengthMs: number) => {
      const step = (timestamp: number) => {
        const elapsed = timestamp - start;
        drawScene(ctx, elapsed / 1000, blueprint);
        setProgress(Math.min(100, (elapsed / lengthMs) * 100));
        if (elapsed <= lengthMs) {
          rafRef.current = requestAnimationFrame(step);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [blueprint],
  );

  const handleGenerate = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      setError(null);
      const canvas = canvasRef.current;
      if (!canvas) {
        setError("Canvas not ready");
        return;
      }

      const mime = preferredMimeType();
      if (!mime) {
        setError("MediaRecorder not supported in this browser");
        return;
      }

      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
        setVideoUrl(null);
      }

      stopAnimation();
      setStatus("rendering");
      setProgress(0);

      canvas.width = resolution;
      canvas.height = resolution;

      const stream = canvas.captureStream(fps);
      const recordedChunks: BlobPart[] = [];

      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 9_000_000,
      });

      recorder.ondataavailable = (eventData) => {
        if (eventData.data.size > 0) {
          recordedChunks.push(eventData.data);
        }
      };

      const recordingDone = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          try {
            const blob = new Blob(recordedChunks, { type: mime });
            resolve(blob);
          } catch (err) {
            reject(err);
          }
        };
        recorder.onerror = (err) => {
          reject(err.error);
        };
      });

      recorder.start();
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setStatus("idle");
        setError("Unable to acquire drawing context");
        recorder.stop();
        return;
      }

      const lengthMs = duration * 1000;
      const start = performance.now();
      renderLoop(ctx, start, lengthMs);

      setTimeout(() => {
        stopAnimation();
        recorder.stop();
      }, lengthMs);

      try {
        const blob = await recordingDone;
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setStatus("ready");
        setProgress(100);
      } catch (err) {
        console.error(err);
        setError("Failed to record video");
        setStatus("idle");
      }
    },
    [duration, fps, renderLoop, resolution, stopAnimation, videoUrl],
  );

  const handlePromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(event.target.value);
  };

  const handleResolutionChange = (event: ChangeEvent<HTMLInputElement>) => {
    setResolution(parseInt(event.target.value, 10));
  };

  const handleDurationChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDuration(parseInt(event.target.value, 10));
  };

  const handleFpsChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setFps(parseInt(event.target.value, 10));
  };

  const resetVideo = () => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setStatus("idle");
    setProgress(0);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status === "rendering") {
      return undefined;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }

    canvas.width = resolution;
    canvas.height = resolution;

    stopAnimation();
    const start = performance.now();
    const loop = (time: number) => {
      const elapsed = time - start;
      drawScene(ctx, elapsed / 1000, blueprint);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      stopAnimation();
    };
  }, [blueprint, resolution, status, stopAnimation]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-12 lg:flex-row lg:gap-12 lg:py-16">
        <section className="flex-1 space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Sora-2 Inspired Video Synthesizer
            </h1>
            <p className="text-base text-slate-300 sm:text-lg">
              Enter a cinematic prompt and synthesize an abstract motion video using our procedural neural field renderer.
            </p>
          </div>
          <form className="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur" onSubmit={handleGenerate}>
            <label className="block text-sm font-medium text-slate-200">
              Prompt
              <textarea
                className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 p-4 text-base text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                rows={5}
                value={prompt}
                onChange={handlePromptChange}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-200">
                Duration (seconds)
                <input
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-base text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                  type="number"
                  min={2}
                  max={12}
                  value={duration}
                  onChange={handleDurationChange}
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Resolution
                <input
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-base text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                  type="number"
                  min={384}
                  max={1024}
                  step={64}
                  value={resolution}
                  onChange={handleResolutionChange}
                />
              </label>
              <label className="block text-sm font-medium text-slate-200">
                Frame Rate
                <select
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-base text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
                  value={fps}
                  onChange={handleFpsChange}
                >
                  {fpsOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} fps
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/30 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700"
                  disabled={status === "rendering"}
                >
                  {status === "rendering" ? "Generating..." : "Generate Video"}
                </button>
              </div>
            </div>

            {error && <p className="rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-200">{error}</p>}
            {status === "rendering" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
                  <span>Rendering neural field</span>
                  <span>{progress.toFixed(0)}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </form>
        </section>

        <section className="flex flex-1 flex-col gap-4">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 p-4 shadow-2xl">
            <canvas ref={canvasRef} className="aspect-square w-full rounded-2xl bg-black" />
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <h2 className="text-lg font-semibold text-white">Output</h2>
            <p className="mt-1 text-sm text-slate-400">
              Video renders in the browser using WebGPU-inspired field synthesis. Save and share the generated sequence once complete.
            </p>
            {videoUrl ? (
              <div className="mt-4 space-y-4">
                <video className="w-full rounded-2xl border border-white/10" src={videoUrl} controls playsInline />
                <div className="flex flex-wrap gap-3">
                  <a
                    href={videoUrl}
                    download={downloadName}
                    className="inline-flex items-center justify-center rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 shadow shadow-emerald-400/40 transition hover:bg-emerald-300"
                  >
                    Download .webm
                  </a>
                  <button
                    type="button"
                    onClick={resetVideo}
                    className="inline-flex items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">
                Generate a prompt-driven motion piece and it will appear here for review.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
