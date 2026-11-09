import 'package:flutter/material.dart';

/// Reportes v2 (catálogo de campos validado en IA): mismas reglas de presentación que la web.

/// Salida elegida en la pantalla: prevalece sobre lo que diga la petición. `null` = según la petición.
const salidasReporte = <(String, List<String>?)>[
  ('Según la petición', null),
  ('En pantalla', ['PANTALLA']),
  ('Solo PDF', ['PDF']),
  ('Solo Excel', ['EXCEL']),
  ('PDF y Excel', ['PDF', 'EXCEL']),
  ('Pantalla y archivos', ['PANTALLA', 'PDF', 'EXCEL']),
];

bool esReporteV2(Map? reporte) =>
    (reporte?['especificacion'] as Map?)?['version'] == 2;

/// Procedencia veraz. El modelo de lenguaje corre en el servidor (Ollama), nunca en el teléfono.
String procedenciaDe(Map reporte) {
  final p = reporte['procedencia'];
  if (p == 'MODELO' || p == 'REGLAS' || p == 'MANUAL') return p as String;
  if (reporte['generativa'] == true) return 'MODELO';
  return '${reporte['observacion'] ?? ''}'.startsWith('Especificación editada')
      ? 'MANUAL'
      : 'REGLAS';
}

const textoProcedencia = {
  'MODELO': 'Interpretado por el modelo de lenguaje del servidor',
  'REGLAS': 'Interpretación limitada por reglas',
  'MANUAL': 'Especificación editada manualmente',
};

/// Pantalla solo si se pidió o no se dijo nada; archivos: los pedidos, o ambos a demanda si no se pidió ninguno.
({bool pantalla, List<String> archivos, bool pedidos}) salidaDe(
  Map especificacion,
) {
  final formatos = [
    for (final f in (especificacion['formatos'] as List? ?? const [])) '$f',
  ];
  final archivos = formatos.where((f) => f != 'PANTALLA').toList();
  return (
    pantalla: formatos.isEmpty || formatos.contains('PANTALLA'),
    archivos: archivos.isEmpty ? const ['PDF', 'EXCEL'] : archivos,
    pedidos: archivos.isNotEmpty,
  );
}

String _miles(int n) {
  final s = n.abs().toString();
  final b = StringBuffer(n < 0 ? '-' : '');
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write('.');
    b.write(s[i]);
  }
  return b.toString();
}

/// Formato boliviano: dinero desde centavos («Bs 1.234,50»), fechas dd/mm/aaaa, sí/no.
String formatoCelda(Object? valor, String tipo) {
  if (valor == null) return '—';
  switch (tipo) {
    case 'DINERO':
      final c = (valor as num).round();
      return 'Bs ${_miles(c ~/ 100)},${(c.abs() % 100).toString().padLeft(2, '0')}';
    case 'ENTERO':
      return _miles((valor as num).round());
    case 'FECHA':
      final p = '$valor'.split('-');
      return p.length >= 3
          ? '${p[2].substring(0, 2)}/${p[1]}/${p[0]}'
          : '$valor';
    case 'BOOLEANO':
      return valor == true ? 'Sí' : 'No';
  }
  return '$valor';
}

/// Resultado de un reporte v2 en el teléfono.
class ResultadoReporteV2 extends StatelessWidget {
  const ResultadoReporteV2({
    super.key,
    required this.reporte,
    required this.deCopia,
    required this.conectada,
    required this.compartir,
  });

  final Map<String, dynamic> reporte;
  final bool deCopia;
  final bool conectada;
  final void Function(String formato) compartir;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final tenue = t.textTheme.bodySmall?.copyWith(
      color: t.colorScheme.onSurfaceVariant,
    );
    final datos = (reporte['datos'] as Map).cast<String, dynamic>();
    final salida = salidaDe(reporte['especificacion'] as Map);
    final procedencia = procedenciaDe(reporte);
    final columnas = [
      for (final c in datos['columnas'] as List)
        (c as Map).cast<String, dynamic>(),
    ];
    final filas = [for (final f in datos['filas'] as List) f as List];
    final totales = ((datos['totales'] as Map?) ?? const {})
        .cast<String, dynamic>();
    final notas = [for (final n in (datos['notas'] as List? ?? const [])) '$n'];
    final grafico = (datos['grafico'] as Map?)?.cast<String, dynamic>();
    final nombres = {'PDF': 'PDF', 'EXCEL': 'Excel'};
    final datosAl = DateTime.tryParse('${datos['datos_al']}')?.toLocal();
    final botones = Wrap(
      spacing: 12,
      runSpacing: 8,
      children: [
        for (final f in salida.archivos)
          OutlinedButton.icon(
            onPressed: conectada ? () => compartir(f) : null,
            icon: Icon(
              f == 'PDF'
                  ? Icons.picture_as_pdf_outlined
                  : Icons.table_chart_outlined,
            ),
            label: Text('Compartir ${nombres[f]}'),
          ),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${datos['titulo']}', style: t.textTheme.titleLarge),
        const SizedBox(height: 6),
        _Etiqueta(
          icono: procedencia == 'MODELO'
              ? Icons.dns_outlined
              : procedencia == 'MANUAL'
              ? Icons.edit_outlined
              : Icons.rule,
          texto: textoProcedencia[procedencia]!,
        ),
        if (deCopia) ...[
          const SizedBox(height: 6),
          // Con red es el último reporte guardado; sin red, la copia es lo único disponible.
          _Etiqueta(
            icono: conectada ? Icons.history : Icons.cloud_off_outlined,
            texto: conectada
                ? 'Último reporte guardado en este teléfono'
                : 'Copia guardada sin conexión',
          ),
        ],
        if (reporte['interpretacion'] is String) ...[
          const SizedBox(height: 6),
          Text('${reporte['interpretacion']}', style: t.textTheme.bodyMedium),
        ],
        Text(
          '${(datos['periodo'] as Map?)?['texto'] ?? ''} · Datos al '
          '${datosAl == null ? '—' : '${datosAl.day.toString().padLeft(2, '0')}/${datosAl.month.toString().padLeft(2, '0')}/${datosAl.year} '
                    '${datosAl.hour.toString().padLeft(2, '0')}:${datosAl.minute.toString().padLeft(2, '0')}'}',
          style: tenue,
        ),
        if (reporte['observacion'] is String) ...[
          const SizedBox(height: 6),
          Text('${reporte['observacion']}', style: tenue),
        ],
        for (final n in notas)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text('· $n', style: tenue),
          ),
        const SizedBox(height: 14),
        if (!salida.pantalla) ...[
          Text(
            'Pediste ${salida.archivos.length == 1 ? 'solo ${nombres[salida.archivos.first]}' : 'PDF y Excel'}: el reporte '
            'está listo para compartir (${datos['total_filas']} ${datos['total_filas'] == 1 ? 'fila' : 'filas'}'
            '${grafico != null ? ', con gráfico' : ''}).',
            style: t.textTheme.bodyMedium,
          ),
          const SizedBox(height: 10),
          botones,
        ] else ...[
          if (grafico != null && (grafico['puntos'] as List).isNotEmpty) ...[
            Text(
              '${grafico['etiqueta_valor']} por ${'${grafico['etiqueta_eje']}'.toLowerCase()}',
              style: t.textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            _Grafico(grafico),
            const SizedBox(height: 14),
          ],
          if (filas.isEmpty)
            const Text('No hay datos para este periodo y filtros.')
          else
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingRowHeight: 40,
                dataRowMinHeight: 36,
                dataRowMaxHeight: 56,
                columnSpacing: 20,
                columns: [
                  for (final c in columnas)
                    DataColumn(
                      label: Text('${c['etiqueta']}'),
                      numeric: c['tipo'] == 'DINERO' || c['tipo'] == 'ENTERO',
                    ),
                ],
                rows: [
                  for (final f in filas)
                    DataRow(
                      cells: [
                        for (var i = 0; i < columnas.length; i++)
                          DataCell(
                            Text(formatoCelda(f[i], '${columnas[i]['tipo']}')),
                          ),
                      ],
                    ),
                  if (totales.isNotEmpty)
                    DataRow(
                      cells: [
                        for (var i = 0; i < columnas.length; i++)
                          DataCell(
                            Text(
                              totales.containsKey(columnas[i]['campo'])
                                  ? formatoCelda(
                                      totales[columnas[i]['campo']],
                                      '${columnas[i]['tipo']}',
                                    )
                                  : (i == 0 ? 'Total' : ''),
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                      ],
                    ),
                ],
              ),
            ),
          const SizedBox(height: 16),
          botones,
        ],
        if (!conectada)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Compartir necesita conexión: el archivo se genera en el servidor.',
              style: tenue,
            ),
          ),
      ],
    );
  }
}

/// Etiqueta de estado que se ajusta en varias líneas (un Chip recortaría el texto en pantallas angostas).
class _Etiqueta extends StatelessWidget {
  const _Etiqueta({required this.icono, required this.texto});
  final IconData icono;
  final String texto;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        border: Border.all(color: t.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icono, size: 18, color: t.colorScheme.onSurfaceVariant),
          const SizedBox(width: 8),
          Flexible(child: Text(texto, style: t.textTheme.labelLarge)),
        ],
      ),
    );
  }
}

/// Barras horizontales (nombres largos) o una línea por fecha; los valores van escritos, no solo dibujados.
class _Grafico extends StatelessWidget {
  const _Grafico(this.g);
  final Map<String, dynamic> g;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    final tipoValor = '${g['tipo_valor']}';
    final puntos = [
      for (final p in g['puntos'] as List) (p as Map).cast<String, dynamic>(),
    ];
    final valores = [for (final p in puntos) (p['valor'] as num).toDouble()];
    final maximo = valores.fold<double>(0, (m, v) => v > m ? v : m);
    String clave(Map p) => g['eje'] == 'FECHA'
        ? formatoCelda(p['clave'], 'FECHA')
        : '${p['clave']}';
    if (g['tipo'] == 'LINEAS' && puntos.length > 1) {
      return Semantics(
        label: puntos
            .map((p) => '${clave(p)}: ${formatoCelda(p['valor'], tipoValor)}')
            .join(', '),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 140,
              child: CustomPaint(
                painter: _Linea(
                  valores,
                  maximo,
                  t.colorScheme.primary,
                  t.colorScheme.outlineVariant,
                ),
              ),
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${clave(puntos.first)} · ${formatoCelda(puntos.first['valor'], tipoValor)}',
                  style: t.textTheme.bodySmall,
                ),
                Text(
                  '${clave(puntos.last)} · ${formatoCelda(puntos.last['valor'], tipoValor)}',
                  style: t.textTheme.bodySmall,
                ),
              ],
            ),
          ],
        ),
      );
    }
    return Column(
      children: [
        for (var i = 0; i < puntos.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Row(
              children: [
                SizedBox(
                  width: 110,
                  child: Text(
                    clave(puntos[i]),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: maximo == 0 ? 0 : valores[i] / maximo,
                      minHeight: 14,
                      backgroundColor: t.colorScheme.surfaceContainer,
                    ),
                  ),
                ),
                SizedBox(
                  width: 104,
                  child: Text(
                    formatoCelda(puntos[i]['valor'], tipoValor),
                    textAlign: TextAlign.end,
                    style: const TextStyle(
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _Linea extends CustomPainter {
  _Linea(this.valores, this.maximo, this.color, this.rejilla);
  final List<double> valores;
  final double maximo;
  final Color color, rejilla;

  @override
  void paint(Canvas canvas, Size size) {
    final tope = maximo <= 0 ? 1.0 : maximo;
    Offset punto(int i) => Offset(
      i * size.width / (valores.length - 1),
      size.height - 6 - (valores[i] / tope) * (size.height - 12),
    );
    canvas.drawLine(
      Offset(0, size.height - 6),
      Offset(size.width, size.height - 6),
      Paint()..color = rejilla,
    );
    final trazo = Path()..moveTo(punto(0).dx, punto(0).dy);
    for (var i = 1; i < valores.length; i++) {
      trazo.lineTo(punto(i).dx, punto(i).dy);
    }
    canvas.drawPath(
      trazo,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5,
    );
    for (var i = 0; i < valores.length; i++) {
      canvas.drawCircle(punto(i), 3.5, Paint()..color = color);
    }
  }

  @override
  bool shouldRepaint(_Linea anterior) => anterior.valores != valores;
}
