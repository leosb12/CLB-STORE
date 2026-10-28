import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ServicioFidelizacion } from "../negocio/servicio-fidelizacion.js";
import { AutenticacionJwt, Roles, type SolicitudAutenticada } from "../../comun/autenticacion.js";
import { SolicitudAcreditacion, SolicitudReversa } from "./solicitudes.js";

// Acreditaciones y reversas son internas (solo la SAGA de Ventas): viven bajo /api/v1/interno, que la pasarela no expone.
@Controller("api/v1")
@UseGuards(AutenticacionJwt)
export class ControladorFidelizacion {
  constructor(private readonly servicio: ServicioFidelizacion) {}

  /** Solo la SAGA de Ventas (token de servicio) acredita puntos. */
  @Post("interno/fidelizacion/acreditaciones")
  @HttpCode(201)
  @Roles("servicio")
  async acreditar(@Headers("idempotency-key") clave: string, @Body() solicitud: SolicitudAcreditacion) {
    const movimiento = await this.servicio.acreditar(this.servicio.validarClave(clave), solicitud.identificador_pedido.toLowerCase(),
      solicitud.identificador_cliente.toLowerCase(), solicitud.total_centavos);
    return { movimiento };
  }

  /** Compensación de la SAGA: solo con token de servicio. */
  @Post("interno/fidelizacion/reversas")
  @HttpCode(201)
  @Roles("servicio")
  async revertir(@Headers("idempotency-key") clave: string, @Body() solicitud: SolicitudReversa) {
    const movimiento = await this.servicio.revertir(this.servicio.validarClave(clave), solicitud.identificador_pedido.toLowerCase(),
      solicitud.identificador_cliente.toLowerCase());
    return { movimiento };
  }

  /** La automatización (n8n) lee los puntos para el comprobante de venta: ruta interna, solo con token de servicio. */
  @Get("interno/fidelizacion/clientes/:id")
  @Roles("servicio")
  async consultarInterno(@Param("id", new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 422 })) id: string,
                         @Query("pedido", new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 422, optional: true })) pedido?: string) {
    const cliente = id.toLowerCase();
    const [resumen, delPedido] = await Promise.all([this.servicio.consultar(cliente),
      pedido ? this.servicio.movimientosDelPedido(cliente, pedido.toLowerCase()) : undefined]);
    return { identificador_cliente: cliente, ...resumen, ...(delPedido && { pedido: { identificador_pedido: pedido!.toLowerCase(), ...delPedido } }) };
  }

  /** Cada cliente ve solo su saldo; un administrador puede ver cualquiera. */
  @Get("fidelizacion/clientes/:id")
  @Roles("cliente", "admin")
  async consultar(@Param("id", new ParseUUIDPipe({ version: "4", errorHttpStatusCode: 422 })) id: string, @Req() solicitud: SolicitudAutenticada) {
    const cliente = id.toLowerCase();
    if (solicitud.titular.sub !== cliente && !solicitud.titular.roles.includes("admin"))
      throw new ForbiddenException({ mensaje: "Solo puedes consultar tus propios puntos.", código: "ACCESO_DENEGADO" });
    return { identificador_cliente: cliente, ...(await this.servicio.consultar(cliente)) };
  }
}
