/** Captura de voz del navegador (MediaRecorder). El audio se envía al servidor de IA local; nunca a un servicio externo. */
export class GrabadoraVoz {
  private grabadora: MediaRecorder | null = null;
  private partes: Blob[] = [];

  static disponible(): boolean {
    return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  /** El permiso del micrófono se pide recién aquí, al pulsar «Hablar». */
  async iniciar(señal: AbortSignal): Promise<void> {
    const flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      señal.throwIfAborted();
      this.partes = [];
      const grabadora = new MediaRecorder(flujo);
      grabadora.ondataavailable = evento => { if (evento.data.size) this.partes.push(evento.data); };
      grabadora.start();
      this.grabadora = grabadora;
    } catch (error) {
      flujo.getTracks().forEach(pista => pista.stop());
      throw error;
    }
  }

  cancelar(): void {
    const grabadora = this.grabadora;
    if (!grabadora) return;
    grabadora.ondataavailable = null;
    grabadora.stream.getTracks().forEach(pista => pista.stop());
    this.grabadora = null;
    this.partes = [];
  }

  detener(): Promise<Blob> {
    const grabadora = this.grabadora;
    if (!grabadora) return Promise.resolve(new Blob());
    return new Promise(resolver => {
      grabadora.onstop = () => {
        grabadora.stream.getTracks().forEach(pista => pista.stop());
        this.grabadora = null;
        resolver(new Blob(this.partes, { type: grabadora.mimeType || "audio/webm" }));
      };
      grabadora.stop();
    });
  }
}
