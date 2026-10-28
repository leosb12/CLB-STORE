import { Inject, Injectable } from "@nestjs/common";
import { ErrorDeFidelizacion } from "../../fidelizacion/negocio/servicio-fidelizacion.js";
import { REPOSITORIO_PERFILES, type Medidas, type Perfil, type RepositorioPerfiles } from "../datos/repositorio-perfiles.js";

export interface CambiosPerfil {
  nombre: string;
  teléfono: string | null;
  medidas: Medidas;
  versión_esperada: number;
}

@Injectable()
export class ServicioPerfiles {
  constructor(@Inject(REPOSITORIO_PERFILES) private readonly repositorio: RepositorioPerfiles) {}

  /** Un cliente nuevo aún no tiene perfil guardado: se responde uno vacío en versión 0. */
  async perfil(cliente: string): Promise<Perfil> {
    return (await this.repositorio.perfil(cliente))
      ?? { identificador_cliente: cliente, nombre: "", teléfono: null, medidas: {}, versión: 0, fecha_actualización: "" };
  }

  /** Edición con versión optimista: dos dispositivos no se pisan; el segundo recibe 409 con el perfil vigente. */
  async editar(cliente: string, cambios: CambiosPerfil): Promise<Perfil> {
    const nuevo: Perfil = { identificador_cliente: cliente, nombre: cambios.nombre.trim(), teléfono: cambios.teléfono?.trim() || null,
      medidas: cambios.medidas, versión: cambios.versión_esperada + 1, fecha_actualización: new Date().toISOString() };
    if (!nuevo.nombre) throw new ErrorDeFidelizacion("El nombre es obligatorio.", "DATOS_INVALIDOS", 422);
    if (await this.repositorio.guardar(nuevo, cambios.versión_esperada)) return nuevo;
    throw new ErrorDeFidelizacion("El perfil cambió en otro dispositivo. Revisa los datos actuales.", "CONFLICTO_VERSION", 409,
      { perfil_actual: await this.perfil(cliente) });
  }
}
