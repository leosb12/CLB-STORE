import { useState } from "react";
import type { PrendaProbador } from "../dominio/contrato";
import { elegir, esVestido, quitar, zonaDe, type Conjunto, type Zona } from "../dominio/conjunto";

const NOMBRE_ZONA: Record<Zona, string> = { superior: "Arriba", inferior: "Abajo" };

/**
 * Paso 1: el conjunto que se prueba. Dos ranuras (arriba y abajo) y las prendas del catálogo de la zona elegida.
 * Cambiar de prenda no apaga la cámara: solo cambia lo que se dibuja encima.
 */
export function SelectorPrendas({ opciones, conjunto, cambiar }: { opciones: PrendaProbador[]; conjunto: Conjunto; cambiar: (c: Conjunto) => void }) {
  const [zona, setZona] = useState<Zona>(() => (conjunto.superior || !conjunto.inferior ? "superior" : "inferior"));
  const visibles = opciones.filter((p) => zonaDe(p) === zona);
  const vestido = esVestido(conjunto.superior);

  return (
    <section aria-labelledby="paso-prendas">
      <h3 id="paso-prendas"><span className="número">1</span>Tus prendas</h3>
      <ul className="ranuras">
        {(["superior", "inferior"] as const).map((z) => {
          const p = conjunto[z];
          const incluida = z === "inferior" && vestido;
          return (
            <li key={z} data-zona={z} data-vacia={!p && !incluida ? "" : undefined}>
              <span className="ranura-zona">{NOMBRE_ZONA[z]}</span>
              {p ? (
                <>
                  <img src={p.imagen} alt="" width={56} height={62} />
                  <span className="ranura-nombre">{p.nombre}</span>
                  <button type="button" className="botón-texto" onClick={() => cambiar(quitar(conjunto, z))} aria-label={`Quitar ${p.nombre}`}>
                    Quitar
                  </button>
                </>
              ) : (
                <span className="ranura-nombre">{incluida ? "Incluido en el vestido" : "Sin prenda"}</span>
              )}
            </li>
          );
        })}
      </ul>
      {opciones.length > 1 && (
        <>
          <div className="zonas" role="group" aria-label="Elegir prendas de">
            {(["superior", "inferior"] as const).map((z) => (
              <button key={z} type="button" className="botón-texto" aria-pressed={zona === z} onClick={() => setZona(z)}>
                {z === "superior" ? "Arriba y vestidos" : "Pantalones"}
              </button>
            ))}
          </div>
          {visibles.length ? (
            <ul className="miniaturas">
              {visibles.map((p) => {
                const puesta = conjunto[zonaDe(p)]?.identificador === p.identificador;
                return (
                  <li key={p.identificador}>
                    <button type="button" aria-pressed={puesta} onClick={() => cambiar(puesta ? quitar(conjunto, zonaDe(p)) : elegir(conjunto, p))}>
                      <img src={p.imagen} alt="" width={72} height={80} loading="lazy" />
                      <span>{p.nombre}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="nota">No hay prendas de esta zona en el catálogo guardado en este dispositivo.</p>
          )}
        </>
      )}
    </section>
  );
}
