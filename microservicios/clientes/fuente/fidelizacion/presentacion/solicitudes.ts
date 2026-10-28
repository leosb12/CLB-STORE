import { IsInt, IsUUID, Max, Min } from "class-validator";

export class SolicitudAcreditacion {
  @IsUUID("4", { message: "identificador_pedido debe ser un UUID v4." }) identificador_pedido!: string;
  @IsUUID("4", { message: "identificador_cliente debe ser un UUID v4." }) identificador_cliente!: string;
  @IsInt({ message: "total_centavos debe ser un entero." })
  @Min(0, { message: "total_centavos no puede ser negativo." })
  @Max(1_000_000_000_000, { message: "total_centavos supera el máximo permitido." })
  total_centavos!: number;
}

export class SolicitudReversa {
  @IsUUID("4", { message: "identificador_pedido debe ser un UUID v4." }) identificador_pedido!: string;
  @IsUUID("4", { message: "identificador_cliente debe ser un UUID v4." }) identificador_cliente!: string;
}
