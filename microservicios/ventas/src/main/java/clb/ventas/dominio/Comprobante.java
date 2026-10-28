package clb.ventas.dominio;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Comprobante de venta de un pedido confirmado (no es una factura fiscal). Lo genera la automatización y el cliente lo
 * descarga; solo se aceptan libros xlsx (ZIP con sus partes obligatorias) o PDF completos, de tamaño acotado.
 */
public record Comprobante(UUID identificadorPedido, String nombre, String tipo, byte[] contenido, String generadoPor, Instant fecha) {

    public static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    public static final String PDF = "application/pdf";
    public static final int TAMAÑO_MÁXIMO = 2 * 1024 * 1024;
    private static final Pattern NOMBRE = Pattern.compile("^[\\p{L}\\p{N} ._-]{1,100}\\.(xlsx|pdf)$");
    private static final byte[] FIRMA_ZIP = {'P', 'K', 3, 4};
    private static final byte[] FIRMA_PDF = {'%', 'P', 'D', 'F', '-'};
    /** Partes que todo libro xlsx tiene (OOXML); se leen solo los nombres del directorio central, sin descomprimir. */
    private static final Set<String> PARTES_XLSX = Set.of("[Content_Types].xml", "xl/workbook.xml");
    private static final int ENTRADAS_MÁXIMAS = 2000;

    public Comprobante {
        Objects.requireNonNull(identificadorPedido);
        Objects.requireNonNull(fecha);
        if (generadoPor == null || generadoPor.isBlank() || generadoPor.length() > 80) throw new ReglaDePedidoIncumplida("El comprobante requiere su origen.");
        if (contenido == null || contenido.length == 0 || contenido.length > TAMAÑO_MÁXIMO)
            throw new ReglaDePedidoIncumplida("El comprobante debe pesar entre 1 byte y 2 MB.");
        // El contenido debe coincidir con el tipo declarado: un xlsx es un ZIP con las partes de un libro; un PDF empieza
        // con %PDF- y termina con %%EOF.
        boolean xlsx = XLSX.equals(tipo);
        if (!(xlsx ? empiezaCon(contenido, FIRMA_ZIP) && esLibroXlsx(contenido)
                : PDF.equals(tipo) && empiezaCon(contenido, FIRMA_PDF) && terminaEnEof(contenido)))
            throw new ReglaDePedidoIncumplida("El comprobante debe ser un xlsx o un PDF válido.");
        if (nombre == null || !NOMBRE.matcher(nombre).matches() || !nombre.endsWith(xlsx ? ".xlsx" : ".pdf"))
            throw new ReglaDePedidoIncumplida("El nombre del comprobante no es válido.");
        contenido = contenido.clone();
    }

    @Override
    public byte[] contenido() {
        return contenido.clone();
    }

    /** Recorre el directorio central del ZIP (fin de archivo → entradas) leyendo solo nombres: nada se infla en memoria. */
    static boolean esLibroXlsx(byte[] d) {
        var b = ByteBuffer.wrap(d).order(ByteOrder.LITTLE_ENDIAN);
        int fin = -1;
        for (int i = d.length - 22; i >= Math.max(0, d.length - 22 - 65_535); i--) {
            if (b.getInt(i) == 0x06054b50) { fin = i; break; }
        }
        if (fin < 0) return false;
        int entradas = b.getShort(fin + 10) & 0xffff;
        long inicio = b.getInt(fin + 16) & 0xffffffffL;
        if (entradas == 0 || entradas > ENTRADAS_MÁXIMAS || inicio >= fin) return false;
        var nombres = new HashSet<String>();
        int p = (int) inicio;
        for (int k = 0; k < entradas; k++) {
            if (p + 46 > fin || b.getInt(p) != 0x02014b50) return false;
            int largo = b.getShort(p + 28) & 0xffff, extra = b.getShort(p + 30) & 0xffff, comentario = b.getShort(p + 32) & 0xffff;
            if (p + 46 + largo > fin) return false;
            nombres.add(new String(d, p + 46, largo, StandardCharsets.UTF_8));
            p += 46 + largo + extra + comentario;
        }
        return nombres.containsAll(PARTES_XLSX);
    }

    private static boolean terminaEnEof(byte[] d) {
        var cola = new String(d, Math.max(0, d.length - 1024), Math.min(1024, d.length), StandardCharsets.ISO_8859_1);
        return cola.stripTrailing().endsWith("%%EOF");
    }

    private static boolean empiezaCon(byte[] datos, byte[] firma) {
        if (datos.length < firma.length) return false;
        for (int i = 0; i < firma.length; i++) if (datos[i] != firma[i]) return false;
        return true;
    }
}
