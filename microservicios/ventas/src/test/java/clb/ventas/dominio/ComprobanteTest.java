package clb.ventas.dominio;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Instant;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;

/** Reglas del comprobante de venta: tipo reconocible por su firma, tamaño acotado y nombre seguro. */
public class ComprobanteTest {

    static final byte[] XLSX = xlsx("libro");

    /** Libro xlsx mínimo con sus partes obligatorias; `marca` distingue dos archivos válidos. */
    public static byte[] xlsx(String marca) {
        return zip("[Content_Types].xml", "xl/workbook.xml", "xl/" + marca + ".xml");
    }

    static byte[] zip(String... partes) {
        try (var salida = new ByteArrayOutputStream(); var zip = new ZipOutputStream(salida)) {
            for (String parte : partes) {
                zip.putNextEntry(new ZipEntry(parte));
                zip.write("<x/>".getBytes());
                zip.closeEntry();
            }
            zip.finish();
            return salida.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Comprobante crear(String nombre, String tipo, byte[] contenido) {
        return new Comprobante(UUID.randomUUID(), nombre, tipo, contenido, "clb-n8n", Instant.parse("2026-10-22T12:00:00Z"));
    }

    @Test
    void acepta_xlsx_y_pdf_con_su_firma_y_copia_el_contenido() {
        var comprobante = crear("comprobante-pedido 12.xlsx", Comprobante.XLSX, XLSX);
        assertArrayEquals(XLSX, comprobante.contenido());
        comprobante.contenido()[0] = 'X';
        assertArrayEquals(XLSX, comprobante.contenido(), "El contenido no se puede alterar desde afuera.");
        assertDoesNotThrow(() -> crear("comprobante.pdf", Comprobante.PDF, "%PDF-1.7\n1 0 obj\n%%EOF\n".getBytes()));
    }

    @Test
    void rechaza_firma_que_no_coincide_con_el_tipo_y_otros_tipos() {
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("comprobante.xlsx", Comprobante.XLSX, "<html>".getBytes()));
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("comprobante.pdf", Comprobante.PDF, XLSX));
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("comprobante.html", "text/html", "<html>".getBytes()));
    }

    @Test
    void la_firma_sola_no_basta_un_zip_cualquiera_o_un_pdf_truncado_se_rechazan() {
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("c.xlsx", Comprobante.XLSX, new byte[] {'P', 'K', 3, 4, 20, 0}));
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("c.xlsx", Comprobante.XLSX, zip("leeme.txt", "foto.png")));
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("c.pdf", Comprobante.PDF, "%PDF-1.7\n1 0 obj".getBytes()));
    }

    @Test
    void rechaza_vacio_demasiado_grande_y_nombres_peligrosos() {
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("c.xlsx", Comprobante.XLSX, new byte[0]));
        var grande = new byte[Comprobante.TAMAÑO_MÁXIMO + 1];
        System.arraycopy(XLSX, 0, grande, 0, XLSX.length);
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("c.xlsx", Comprobante.XLSX, grande));
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("../c.xlsx", Comprobante.XLSX, XLSX));
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("c\".xlsx", Comprobante.XLSX, XLSX));
        assertThrows(ReglaDePedidoIncumplida.class, () -> crear("c.pdf", Comprobante.XLSX, XLSX));
    }
}
