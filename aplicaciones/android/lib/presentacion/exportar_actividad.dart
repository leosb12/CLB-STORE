import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';

import '../dominio/actividad.dart';

/// «10/11/2026 14:32:05» en hora local.
String fechaHora(DateTime fecha) {
  final f = fecha.toLocal();
  String d(int n) => n.toString().padLeft(2, '0');
  return '${d(f.day)}/${d(f.month)}/${f.year} ${d(f.hour)}:${d(f.minute)}:${d(f.second)}';
}

String etiquetaSeveridad(Severidad s) => s.name.toUpperCase();

List<String> _columnas(EventoActividad e) => [
  fechaHora(e.fecha),
  etiquetaSeveridad(e.severidad),
  e.categoria,
  e.funcionalidad,
  e.descripcion,
];

const _encabezados = [
  'Fecha y hora',
  'Severidad',
  'Categoría',
  'Funcionalidad',
  'Descripción',
];

Uint8List exportarTxt(List<EventoActividad> eventos) => Uint8List.fromList(
  utf8.encode(
    [
      'CLB Store — Registro de actividad (${eventos.length} eventos)',
      '',
      for (final e in eventos) _columnas(e).join(' | '),
    ].join('\n'),
  ),
);

// ---- PDF: texto plano en Helvetica, sin dependencias (el paquete pdf no es compatible con image ^4.12). ----------

const _winAnsi = {
  '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, //
  '•': 0x95, '–': 0x96, '—': 0x97,
};

List<int> _codificar(String texto) {
  final salida = <int>[];
  for (final c in texto.runes) {
    final s = String.fromCharCode(c);
    final b = _winAnsi[s] ?? (c < 256 ? c : 0x3F);
    if (b == 0x28 || b == 0x29 || b == 0x5C) salida.add(0x5C);
    salida.add(b);
  }
  return salida;
}

List<String> _envolver(String linea, int ancho) {
  final partes = <String>[];
  var resto = linea;
  while (resto.length > ancho) {
    var corte = resto.lastIndexOf(' ', ancho);
    if (corte <= 0) corte = ancho;
    partes.add(resto.substring(0, corte));
    resto = '    ${resto.substring(corte).trimLeft()}';
  }
  return partes..add(resto);
}

Uint8List exportarPdf(List<EventoActividad> eventos) {
  const porPagina = 58, alto = 842, margen = 40, interlinea = 13;
  final lineas = [
    'CLB Store - Registro de actividad (${eventos.length} eventos)',
    '',
    for (final e in eventos) ..._envolver(_columnas(e).join(' | '), 100),
  ];
  final paginas = [
    for (var i = 0; i < lineas.length; i += porPagina)
      lineas.sublist(i, (i + porPagina).clamp(0, lineas.length)),
  ];
  if (paginas.isEmpty) paginas.add(const ['Sin eventos.']);

  final salida = BytesBuilder();
  final desplazamientos = <int>[];
  void objeto(List<int> cuerpo) {
    desplazamientos.add(salida.length);
    salida
      ..add(latin1.encode('${desplazamientos.length} 0 obj\n'))
      ..add(cuerpo)
      ..add(latin1.encode('\nendobj\n'));
  }

  salida.add(latin1.encode('%PDF-1.4\n'));
  // 1 catálogo, 2 páginas, 3 fuente; después cada página (4, 6, …) y su contenido (5, 7, …).
  objeto(latin1.encode('<< /Type /Catalog /Pages 2 0 R >>'));
  final hijos = [for (var i = 0; i < paginas.length; i++) '${4 + 2 * i} 0 R'];
  objeto(
    latin1.encode(
      '<< /Type /Pages /Kids [${hijos.join(' ')}] /Count ${paginas.length} >>',
    ),
  );
  objeto(
    latin1.encode(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ),
  );
  for (var i = 0; i < paginas.length; i++) {
    objeto(
      latin1.encode(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 $alto] '
        '/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>',
      ),
    );
    final contenido = BytesBuilder()
      ..add(
        latin1.encode(
          'BT /F1 9 Tf $interlinea TL $margen ${alto - margen} Td\n',
        ),
      );
    for (final l in paginas[i]) {
      contenido
        ..add(latin1.encode('('))
        ..add(_codificar(l))
        ..add(latin1.encode(") '\n"));
    }
    contenido.add(latin1.encode('ET'));
    final bytes = contenido.toBytes();
    objeto([
      ...latin1.encode('<< /Length ${bytes.length} >>\nstream\n'),
      ...bytes,
      ...latin1.encode('\nendstream'),
    ]);
  }
  final xref = salida.length;
  salida.add(
    latin1.encode(
      'xref\n0 ${desplazamientos.length + 1}\n0000000000 65535 f \n'
      '${desplazamientos.map((d) => '${d.toString().padLeft(10, '0')} 00000 n \n').join()}'
      'trailer\n<< /Size ${desplazamientos.length + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n',
    ),
  );
  return salida.toBytes();
}

// ---- Excel: libro .xlsx mínimo (una hoja, texto en línea), comprimido con archive. ------------------------------

String _xml(String s) => s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

String _fila(int n, List<String> celdas) =>
    '<row r="$n">${[for (final c in celdas) '<c t="inlineStr"><is><t xml:space="preserve">${_xml(c)}</t></is></c>'].join()}</row>';

Uint8List exportarXlsx(List<EventoActividad> eventos) {
  final filas = [
    _fila(1, _encabezados),
    for (var i = 0; i < eventos.length; i++)
      _fila(i + 2, _columnas(eventos[i])),
  ].join();
  const cabecera = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  final libro = Archive()
    ..addFile(
      ArchiveFile.string(
        '[Content_Types].xml',
        '$cabecera<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '</Types>',
      ),
    )
    ..addFile(
      ArchiveFile.string(
        '_rels/.rels',
        '$cabecera<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>',
      ),
    )
    ..addFile(
      ArchiveFile.string(
        'xl/workbook.xml',
        '$cabecera<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Actividad" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
    )
    ..addFile(
      ArchiveFile.string(
        'xl/_rels/workbook.xml.rels',
        '$cabecera<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '</Relationships>',
      ),
    )
    ..addFile(
      ArchiveFile.string(
        'xl/worksheets/sheet1.xml',
        '$cabecera<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="11" customWidth="1"/>'
            '<col min="3" max="4" width="22" customWidth="1"/><col min="5" max="5" width="70" customWidth="1"/></cols>'
            '<sheetData>$filas</sheetData></worksheet>',
      ),
    );
  return ZipEncoder().encodeBytes(libro);
}
