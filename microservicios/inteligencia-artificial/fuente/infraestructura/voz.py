"""Transcripción local con faster-whisper (CPU, int8). Sin proveedor externo: el audio no sale de la máquina.

El modelo se descarga una sola vez al volumen `clb_modelos_ia`; para la demo sin Internet, precargarlo antes con
`docker exec clb_backend_ia python -m fuente.infraestructura.voz`.
"""
import asyncio
import os
import tempfile

SEGUNDOS_MAXIMOS = 60


class TranscriptorOcupado(Exception):
    pass


class TranscriptorWhisper:
    def __init__(self, modelo: str, directorio: str):
        self.nombre, self.directorio, self._modelo = modelo, directorio, None
        self._cerrojo = asyncio.Lock()

    def _cargar(self):
        if self._modelo is None:
            from faster_whisper import WhisperModel  # carga diferida: el arranque del servicio no espera al modelo
            self._modelo = WhisperModel(self.nombre, device="cpu", compute_type="int8", download_root=self.directorio,
                                        cpu_threads=int(os.environ.get('CLB_IA_HILOS_VOZ', '2')))
        return self._modelo

    def _transcribir(self, audio: bytes) -> str:
        from faster_whisper import decode_audio
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as archivo:
            archivo.write(audio)
        try:
            # Una petición de reporte dura segundos: se transcribe como máximo 1 minuto (16 kHz).
            muestras = decode_audio(archivo.name)[: SEGUNDOS_MAXIMOS * 16000]
            segmentos, _ = self._cargar().transcribe(muestras, language="es", beam_size=1, vad_filter=True)
            return " ".join(s.text.strip() for s in segmentos).strip()
        finally:
            os.unlink(archivo.name)

    async def transcribir(self, audio: bytes) -> str:
        if self._cerrojo.locked():  # un audio a la vez: el modelo no es reentrante y la CPU es limitada
            raise TranscriptorOcupado()
        async with self._cerrojo:
            return await asyncio.to_thread(self._transcribir, audio)


if __name__ == "__main__":
    TranscriptorWhisper(os.environ.get("CLB_IA_MODELO_VOZ", "small"), os.environ.get("CLB_IA_DIRECTORIO_MODELOS", "/modelos"))._cargar()
    print("Modelo de voz listo.")
