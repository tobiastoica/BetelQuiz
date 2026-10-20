// Audio synthesizer for BetelQuiz using Web Audio API

class SoundEngine {
  private ctx: AudioContext | null = null;
  public isMuted: boolean = false;
  private lobbyInterval: any = null;
  private wasLobbyMusicActive: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlockAudio = () => {
        const ctx = this.getContext();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        if (this.wasLobbyMusicActive && !this.isMuted && !this.lobbyInterval) {
          this.playLobbyMusic();
        }
      };
      window.addEventListener('click', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
      window.addEventListener('touchstart', unlockAudio, { passive: true });
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      if (this.lobbyInterval) {
        clearInterval(this.lobbyInterval);
        this.lobbyInterval = null;
      }
    } else {
      if (this.wasLobbyMusicActive) {
        this.playLobbyMusic();
      }
    }
    return this.isMuted;
  }

  public playTone(freq: number, type: OscillatorType, duration: number, gainValue = 0.2, delay = 0) {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    setTimeout(() => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        gain.gain.setValueAtTime(gainValue, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
      } catch {
        // audio context not ready
      }
    }, delay * 1000);
  }

  // Ticking countdown clock
  public playCountdownTick(isUrgent = false) {
    if (this.isMuted) return;
    const freq = isUrgent ? 880 : 440;
    this.playTone(freq, 'sine', 0.08, 0.15);
  }

  // Question reveal whoosh
  public playWhoosh() {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.3);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }

  // Time's up gong
  public playTimeUp() {
    if (this.isMuted) return;
    this.playTone(220, 'sawtooth', 0.6, 0.25);
    this.playTone(180, 'sine', 0.8, 0.25, 0.05);
  }

  // Correct answer chime (C5 - E5 - G5 - C6 arpeggio)
  public playCorrect() {
    if (this.isMuted) return;
    this.playTone(523.25, 'sine', 0.2, 0.25, 0);
    this.playTone(659.25, 'sine', 0.2, 0.25, 0.08);
    this.playTone(783.99, 'sine', 0.2, 0.25, 0.16);
    this.playTone(1046.5, 'sine', 0.4, 0.3, 0.24);
  }

  // Wrong answer buzz (descending dissonant buzz)
  public playWrong() {
    if (this.isMuted) return;
    this.playTone(200, 'sawtooth', 0.3, 0.3, 0);
    this.playTone(170, 'sawtooth', 0.4, 0.3, 0.15);
  }

  // Victory fanfare for podium
  public playFanfare() {
    if (this.isMuted) return;
    const notes = [
      { f: 523.25, d: 0.15, delay: 0 },
      { f: 523.25, d: 0.15, delay: 0.15 },
      { f: 523.25, d: 0.15, delay: 0.3 },
      { f: 659.25, d: 0.4, delay: 0.45 },
      { f: 587.33, d: 0.2, delay: 0.9 },
      { f: 659.25, d: 0.2, delay: 1.1 },
      { f: 783.99, d: 0.8, delay: 1.3 },
    ];
    notes.forEach((n) => {
      this.playTone(n.f, 'triangle', n.d, 0.3, n.delay);
    });
  }

  // Upbeat bouncy Kahoot-style lobby rhythm
  public playLobbyMusic() {
    this.wasLobbyMusicActive = true;
    if (this.isMuted || this.lobbyInterval) return;
    this.getContext();
    const bassline = [130.81, 146.83, 164.81, 196.0, 164.81, 146.83];
    let step = 0;

    this.lobbyInterval = setInterval(() => {
      if (this.isMuted) return;
      const freq = bassline[step % bassline.length];
      this.playTone(freq, 'triangle', 0.15, 0.12);

      // Play snappy upbeat hat/pip
      if (step % 2 === 1) {
        this.playTone(587.33, 'sine', 0.08, 0.08);
      }
      step++;
    }, 280);
  }

  public stopLobbyMusic() {
    this.wasLobbyMusicActive = false;
    if (this.lobbyInterval) {
      clearInterval(this.lobbyInterval);
      this.lobbyInterval = null;
    }
  }
}

export const sound = new SoundEngine();
