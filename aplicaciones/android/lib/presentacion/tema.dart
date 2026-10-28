import 'package:flutter/material.dart';

/// Mundo visual de la tienda web traducido a roles de Material 3 (brief: `contexto/fases/fase-11-android-brief.md`).
abstract final class Clb {
  static const verde = Color(0xFF254E43);
  static const crema = Color(0xFFF8F7F3);
  static const tinta = Color(0xFF222E29);
  static const tenue = Color(
    0xFF5E6A62,
  ); // #66726a de la web, oscurecido para 4.5:1 sobre la superficie de prenda
  static const borde = Color(0xFFDEDFD6);
  static const superficiePrenda = Color(0xFFE9E8DF);
  static const cobre = Color(0xFFAA703B);
  static const cobreOscuro = Color(0xFF694821);
  static const serif = 'Gelasio';
}

const _claro = ColorScheme(
  brightness: Brightness.light,
  primary: Clb.verde,
  onPrimary: Color(0xFFF0F4EC),
  primaryContainer: Color(0xFFD5E4DC),
  onPrimaryContainer: Color(0xFF0E2A22),
  secondary: Clb.cobreOscuro,
  onSecondary: Colors.white,
  secondaryContainer: Color(0xFFF3E3D2),
  onSecondaryContainer: Color(0xFF3B2611),
  tertiary: Clb.cobre,
  onTertiary: Colors.white,
  error: Color(0xFFA3322A),
  onError: Colors.white,
  errorContainer: Color(0xFFF7DEDA),
  onErrorContainer: Color(0xFF5C150F),
  surface: Clb.crema,
  onSurface: Clb.tinta,
  onSurfaceVariant: Clb.tenue,
  surfaceContainerLowest: Colors.white,
  surfaceContainerLow: Color(0xFFF3F2EC),
  surfaceContainer: Color(0xFFEFEEE7),
  surfaceContainerHigh: Clb.superficiePrenda,
  surfaceContainerHighest: Color(0xFFE2E1D7),
  outline: Color(0xFF8E978F),
  outlineVariant: Clb.borde,
  inverseSurface: Clb.tinta,
  onInverseSurface: Clb.crema,
  inversePrimary: Color(0xFF9CC7B5),
);

// Mismos roles sobre carbón verdoso: verde claro como primario y la superficie de prenda como un gris cálido profundo.
const _oscuro = ColorScheme(
  brightness: Brightness.dark,
  primary: Color(0xFF9CC7B5),
  onPrimary: Color(0xFF0E2A22),
  primaryContainer: Color(0xFF254E43),
  onPrimaryContainer: Color(0xFFD5E4DC),
  secondary: Color(0xFFE2B98F),
  onSecondary: Color(0xFF3B2611),
  secondaryContainer: Color(0xFF543A1E),
  onSecondaryContainer: Color(0xFFF3E3D2),
  tertiary: Color(0xFFE2B98F),
  onTertiary: Color(0xFF3B2611),
  error: Color(0xFFF2B8B0),
  onError: Color(0xFF5C150F),
  errorContainer: Color(0xFF7D251E),
  onErrorContainer: Color(0xFFF7DEDA),
  surface: Color(0xFF141A17),
  onSurface: Color(0xFFE6E7E0),
  onSurfaceVariant: Color(0xFFB4BCB4),
  surfaceContainerLowest: Color(0xFF0F1412),
  surfaceContainerLow: Color(0xFF1A211E),
  surfaceContainer: Color(0xFF1E2522),
  surfaceContainerHigh: Color(0xFF29302C),
  surfaceContainerHighest: Color(0xFF333A36),
  outline: Color(0xFF8A938C),
  outlineVariant: Color(0xFF3A433E),
  inverseSurface: Color(0xFFE6E7E0),
  onInverseSurface: Color(0xFF1A211E),
  inversePrimary: Clb.verde,
);

ThemeData temaClb(Brightness brillo) {
  final colores = brillo == Brightness.light ? _claro : _oscuro;
  final base = ThemeData(colorScheme: colores, useMaterial3: true);
  // Serif solo donde la web usa Georgia: títulos, nombre de prenda, precio y talla. La interfaz queda en Roboto.
  TextStyle? serif(TextStyle? s, {double? tracking}) => s?.copyWith(
    fontFamily: Clb.serif,
    letterSpacing: tracking,
    fontWeight: FontWeight.w400,
  );
  final texto = base.textTheme.copyWith(
    displaySmall: serif(base.textTheme.displaySmall, tracking: -0.8),
    headlineMedium: serif(base.textTheme.headlineMedium, tracking: -0.6),
    headlineSmall: serif(base.textTheme.headlineSmall, tracking: -0.4),
    titleLarge: serif(base.textTheme.titleLarge, tracking: -0.2),
    titleMedium: serif(base.textTheme.titleMedium),
  );
  const recto = RoundedRectangleBorder(
    borderRadius: BorderRadius.all(Radius.circular(2)),
  );
  return base.copyWith(
    textTheme: texto,
    scaffoldBackgroundColor: colores.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: colores.surface,
      foregroundColor: colores.onSurface,
      surfaceTintColor: Colors.transparent,
      scrolledUnderElevation: 0,
      titleTextStyle: texto.titleLarge?.copyWith(color: colores.onSurface),
      shape: Border(bottom: BorderSide(color: colores.outlineVariant)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: colores.surfaceContainerLow,
      indicatorColor: colores.primaryContainer,
      indicatorShape: recto,
      surfaceTintColor: Colors.transparent,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: recto,
        minimumSize: const Size(64, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        shape: recto,
        minimumSize: const Size(64, 48),
        side: BorderSide(color: colores.outline),
        padding: const EdgeInsets.symmetric(horizontal: 20),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        shape: recto,
        minimumSize: const Size(48, 48),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      shape: recto,
      side: BorderSide(color: colores.outlineVariant),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: const OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(2)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(2)),
        borderSide: BorderSide(color: colores.outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(2)),
        borderSide: BorderSide(color: Clb.cobre, width: 2),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: recto,
    ),
    dividerTheme: DividerThemeData(
      color: colores.outlineVariant,
      thickness: 1,
      space: 1,
    ),
    cardTheme: const CardThemeData(
      shape: recto,
      elevation: 0,
      margin: EdgeInsets.zero,
    ),
    listTileTheme: const ListTileThemeData(minTileHeight: 56),
  );
}
