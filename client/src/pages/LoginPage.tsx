import { FormEvent, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import "./login.css";

const MIN_SPEED = 18;
const MAX_SPEED = 110;
const ACCEL = 42;
const WALL_DAMP = 0.22;
const TURN_RATE = 0.22;
const REPEL_RADIUS = 150;
const REPEL_STRENGTH = 380;

function AsideWaves() {
  return (
    <>
      <span className="login-aside-wave login-aside-wave--a" />
      <span className="login-aside-wave login-aside-wave--b" />
      <span className="login-aside-wave login-aside-wave--c" />
    </>
  );
}

export function LoginPage() {
  const { user, booting, login } = useAuth();
  const [loginId, setLoginId] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const asideRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const motionRef = useRef({
    x: 0,
    y: 0,
    angle: Math.PI * 0.28,
    speed: MIN_SPEED,
    ready: false,
  });

  useEffect(() => {
    const aside = asideRef.current;
    const mark = markRef.current;
    const surface = surfaceRef.current;
    if (!aside || !mark || !surface) return;

    const surfaceEl = surface;
    let rafId = 0;
    let lastTime = performance.now();

    function onPointerMove(e: PointerEvent) {
      const rect = aside!.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }

    function onPointerLeave() {
      mouseRef.current = null;
    }

    function ensureBounds() {
      const asideEl = aside!;
      const markEl = mark!;
      const maxX = Math.max(0, asideEl.clientWidth - markEl.offsetWidth);
      const maxY = Math.max(0, asideEl.clientHeight - markEl.offsetHeight);
      const motion = motionRef.current;

      if (!motion.ready) {
        motion.x = maxX * 0.55;
        motion.y = maxY * 0.18;
        motion.ready = true;
      }

      return { maxX, maxY };
    }

    function bounce(axis: "x" | "y") {
      const motion = motionRef.current;
      if (axis === "x") {
        motion.angle = Math.PI - motion.angle;
      } else {
        motion.angle = -motion.angle;
      }
      motion.speed = Math.max(MIN_SPEED, motion.speed * WALL_DAMP);
    }

    function tick(now: number) {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const { maxX, maxY } = ensureBounds();
      const motion = motionRef.current;
      const markEl = mark!;
      const size = markEl.offsetWidth;
      let cx = motion.x + size / 2;
      let cy = motion.y + size / 2;

      motion.angle += Math.sin(now * 0.00035) * TURN_RATE * dt;
      motion.speed = Math.min(MAX_SPEED, motion.speed + ACCEL * dt);

      let vx = Math.cos(motion.angle) * motion.speed;
      let vy = Math.sin(motion.angle) * motion.speed;

      const mouse = mouseRef.current;
      if (mouse) {
        const dx = cx - mouse.x;
        const dy = cy - mouse.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < REPEL_RADIUS) {
          const force = ((REPEL_RADIUS - dist) / REPEL_RADIUS) * REPEL_STRENGTH;
          vx += (dx / dist) * force;
          vy += (dy / dist) * force;
          motion.speed = Math.min(
            MAX_SPEED,
            Math.max(motion.speed, Math.hypot(vx, vy) * 0.55),
          );
        }
      }

      motion.x += vx * dt;
      motion.y += vy * dt;

      if (motion.x <= 0) {
        motion.x = 0;
        bounce("x");
      } else if (motion.x >= maxX) {
        motion.x = maxX;
        bounce("x");
      }

      if (motion.y <= 0) {
        motion.y = 0;
        bounce("y");
      } else if (motion.y >= maxY) {
        motion.y = maxY;
        bounce("y");
      }

      cx = motion.x + size / 2;
      cy = motion.y + size / 2;

      markEl.style.transform = `translate(${motion.x}px, ${motion.y}px)`;
      surfaceEl.style.transform = `translate(${cx}px, ${cy}px)`;
      surfaceEl.style.setProperty("--bubble-size", `${size}px`);

      rafId = requestAnimationFrame(tick);
    }

    aside.addEventListener("pointermove", onPointerMove);
    aside.addEventListener("pointerleave", onPointerLeave);
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      aside.removeEventListener("pointermove", onPointerMove);
      aside.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  if (!booting && user) {
    return (
      <Navigate
        to={user.must_change_password ? "/trocar-senha" : "/"}
        replace
      />
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(loginId, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel">
        <p className="login-eyebrow label-cond">Arara · SST</p>
        <h1 className="login-brand">Portal NR-1</h1>
        <p className="login-lead muted">
          Entre com seu login ou e-mail para acessar inventário, ações e
          conformidade.
        </p>
        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-field">
            Login ou e-mail
            <input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="login-field">
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <Button type="submit" disabled={loading || booting}>
            {loading ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </div>
      <div className="login-aside login-aside-scene" aria-hidden ref={asideRef}>
        <svg className="login-aside-filters" aria-hidden>
          <filter
            id="login-water"
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
            filterUnits="objectBoundingBox"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.02"
              numOctaves="2"
              seed="3"
              result="noise"
            >
              <animate
                attributeName="baseFrequency"
                dur="14s"
                values="0.012 0.02;0.017 0.014;0.012 0.02"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="26"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </svg>

        <div className="login-aside-water">
          <div className="login-aside-caustics" />
          <div className="login-aside-waves">
            <AsideWaves />
          </div>
        </div>

        <div className="login-aside-surface" ref={surfaceRef}>
          <span className="login-aside-surface-ring login-aside-surface-ring--a" />
          <span className="login-aside-surface-ring login-aside-surface-ring--b" />
          <span className="login-aside-surface-ring login-aside-surface-ring--c" />
        </div>

        <div className="login-aside-mark" ref={markRef}>
          <div className="login-aside-mark-glass" />
        </div>
      </div>
    </div>
  );
}
