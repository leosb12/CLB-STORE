"""Objetos en primer plano: detector COCO local, residente en CUDA, sin descargas."""
from PIL import Image, ImageDraw


class DetectorOclusiones:
    def __init__(self, ruta):
        import torch
        from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_fpn
        from torchvision.transforms.functional import to_tensor

        self.tensor = to_tensor
        self.modelo = fasterrcnn_mobilenet_v3_large_fpn(weights=None, weights_backbone=None)
        self.modelo.load_state_dict(torch.load(ruta, map_location="cpu", weights_only=True))
        self.modelo.eval().to("cuda")

    def mascara(self, imagen, region=None):
        regiones = [(0, 0, imagen.width, imagen.height)]
        if region:
            x1, y1, x2, y2 = region
            margen = max(8, round((x2 - x1) * 0.15))
            region = (max(0, x1 - margen), max(0, y1 - margen), min(imagen.width, x2 + margen), min(imagen.height, y2 + margen))
            regiones.extend([region, (region[0], region[1], region[2], round(region[1] + (region[3] - region[1]) * 0.65))])
        salidas = self.modelo([self.tensor(imagen.crop(caja)).to("cuda") for caja in regiones])
        mascara = Image.new("L", imagen.size)
        dibujo = ImageDraw.Draw(mascara)
        # COCO 77: cell phone; 27/31: backpack/handbag. Protegemos también su borde.
        for salida, region in zip(salidas, regiones):
            for caja, clase, confianza in zip(salida["boxes"].cpu().tolist(), salida["labels"].cpu().tolist(), salida["scores"].cpu().tolist()):
                if clase not in (27, 31, 77) or confianza < 0.35:
                    continue
                x1, y1, x2, y2 = caja
                x1, x2 = x1 + region[0], x2 + region[0]
                y1, y2 = y1 + region[1], y2 + region[1]
                margen = max(3, round(max(x2 - x1, y2 - y1) * 0.03))
                dibujo.rectangle((max(0, x1 - margen), max(0, y1 - margen),
                                  min(imagen.width - 1, x2 + margen), min(imagen.height - 1, y2 + margen)), fill=255)
        return mascara
