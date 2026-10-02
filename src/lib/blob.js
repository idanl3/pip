/**
 * Pip's blob.
 *
 * Four things it has to do, in order of how much they matter to a five-year-old
 * standing in front of it:
 *
 *   1. Be alive even when nothing is happening, so the screen does not look
 *      broken while two children are deciding who speaks first.
 *   2. React to *their* voices, not to a timer. Children work out within
 *      seconds whether a thing is really listening, and a blob that pulses on
 *      a loop is a lie they will catch.
 *   3. Move differently when Pip speaks than when Pip listens, so whose turn
 *      it is can be seen from across the room without reading anything.
 *   4. Look unmistakably finished when the session ends. A blob that keeps
 *      breathing after goodbye is the visual version of the bug the owner
 *      found at home, where Pip said goodbye and kept listening.
 *
 * The wobble is a sum of sines rather than real noise: cheap, smooth, and
 * never repeats visibly at these periods. The audio level only ever adds to
 * that, so a silent room still breathes.
 */

const STATES = {
  // amp: how much the shape wobbles. react: how much voice adds on top.
  // speed: how fast the wobble travels. glow: outer softness.
  idle: { amp: 0.055, react: 0.0, speed: 0.35, scale: 1.0, glow: 0.3, alpha: 1 },
  listening: { amp: 0.06, react: 0.5, speed: 0.5, scale: 1.02, glow: 0.45, alpha: 1 },
  speaking: { amp: 0.1, react: 0.75, speed: 1.05, scale: 1.06, glow: 0.7, alpha: 1 },
  thinking: { amp: 0.045, react: 0.0, speed: 0.8, scale: 0.97, glow: 0.35, alpha: 1 },
  ended: { amp: 0.02, react: 0.0, speed: 0.12, scale: 0.72, glow: 0.05, alpha: 0.45 },
};

const POINTS = 96;

export class PipBlob {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{reducedMotion?: boolean}} options
   */
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.reducedMotion = reducedMotion;

    this.state = 'idle';
    this.target = STATES.idle;
    this.current = { ...STATES.idle };

    this.level = 0;
    this.smoothed = 0;
    this.time = 0;
    this.running = false;
    this.lastFrame = 0;

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);

    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(canvas);
    this.resize();
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const box = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(box.width));
    this.height = Math.max(1, Math.round(box.height));
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  setState(name) {
    if (!STATES[name]) return;
    this.state = name;
    this.target = STATES[name];
    if (name === 'ended') this.level = 0;
  }

  /**
   * The newest audio levels, 0 to 1.
   *
   * Whichever side is louder drives the shape. Taking the maximum rather than
   * only the active speaker means a child interrupting Pip still moves the
   * blob, which is honest: it really is hearing them.
   */
  setLevels({ input = 0, output = 0 } = {}) {
    this.level = Math.max(0, Math.min(1, Math.max(input, output)));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  destroy() {
    this.stop();
    this.observer.disconnect();
  }

  frame(now) {
    if (!this.running) return;

    const delta = Math.min((now - this.lastFrame) / 1000, 1 / 20);
    this.lastFrame = now;

    // Ease towards the target state rather than snapping. A hard jump between
    // listening and speaking reads as a glitch; a quarter-second glide reads
    // as the thing turning its attention.
    const ease = 1 - Math.exp(-delta * 6);
    for (const key of Object.keys(this.current)) {
      this.current[key] += (this.target[key] - this.current[key]) * ease;
    }

    // Audio rises fast and falls slow. Following the raw level in both
    // directions makes the blob flicker on every consonant.
    const rising = this.level > this.smoothed;
    const audioEase = 1 - Math.exp(-delta * (rising ? 18 : 5));
    this.smoothed += (this.level - this.smoothed) * audioEase;

    this.time += delta * this.current.speed * (this.reducedMotion ? 0.3 : 1);

    this.draw();
    requestAnimationFrame(this.frame);
  }

  draw() {
    const { context: ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);

    const centreX = width / 2;
    const centreY = height / 2;
    const base = Math.min(width, height) * 0.3 * this.current.scale;

    const amp = this.reducedMotion ? this.current.amp * 0.4 : this.current.amp;
    const react = this.current.react * this.smoothed * (this.reducedMotion ? 0.4 : 1);

    ctx.globalAlpha = this.current.alpha;

    // Three offset layers. One blob is a shape; three overlapping translucent
    // ones read as something with depth and a bit of life in it.
    const layers = [
      { phase: 0, radius: 1.0, stops: ['#ffc182', '#ff8a6b'], alpha: 0.95, blur: 0 },
      { phase: 2.1, radius: 0.92, stops: ['#f4789a', 'rgba(244,120,154,0)'], alpha: 0.55, blur: 2 },
      { phase: 4.3, radius: 0.86, stops: ['#4fc3b1', 'rgba(79,195,177,0)'], alpha: 0.45, blur: 2 },
    ];

    // A soft outer glow, strongest while Pip talks.
    ctx.save();
    ctx.filter = 'none';
    const glow = ctx.createRadialGradient(centreX, centreY, base * 0.6, centreX, centreY, base * 2.1);
    glow.addColorStop(0, `rgba(255,138,107,${0.22 * this.current.glow})`);
    glow.addColorStop(1, 'rgba(255,138,107,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    for (const layer of layers) {
      ctx.save();
      ctx.globalAlpha = this.current.alpha * layer.alpha;
      if (layer.blur) ctx.filter = `blur(${layer.blur}px)`;

      ctx.beginPath();
      const radius = base * layer.radius;

      for (let i = 0; i <= POINTS; i++) {
        const angle = (i / POINTS) * Math.PI * 2;
        const wobble = this.wobble(angle, layer.phase);
        const r = radius * (1 + wobble * amp + react * 0.22 * (0.6 + 0.4 * wobble));
        const x = centreX + Math.cos(angle) * r;
        const y = centreY + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      const fill = ctx.createRadialGradient(
        centreX - radius * 0.3,
        centreY - radius * 0.35,
        radius * 0.1,
        centreX,
        centreY,
        radius * 1.15,
      );
      fill.addColorStop(0, layer.stops[0]);
      fill.addColorStop(1, layer.stops[1]);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  /**
   * An organic-looking deviation for a given angle, in roughly -1..1.
   *
   * Three sines at incommensurable frequencies. The angle terms make the shape
   * lumpy around its circumference; the time terms make those lumps travel.
   * Nothing here is random: a shape that jitters randomly looks broken, and
   * the whole point is that it looks like it is breathing.
   */
  wobble(angle, phase) {
    const t = this.time;
    return (
      0.55 * Math.sin(angle * 3 + t * 1.1 + phase) +
      0.3 * Math.sin(angle * 5 - t * 0.7 + phase * 1.7) +
      0.15 * Math.sin(angle * 2 + t * 1.6 + phase * 0.4)
    );
  }
}
