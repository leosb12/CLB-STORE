"""Ejecutar con n8n detenido, volumen montado en /datos y sin red."""
import sqlite3

with sqlite3.connect('/datos/database.sqlite') as db:
    db.execute('PRAGMA foreign_keys=ON')
    tablas = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    # Datos de ejecuciones: conservar usuarios, credenciales y definiciones de flujos.
    for tabla in ('execution_metadata','execution_annotations','execution_data','execution_entity'):
        if tabla in tablas:
            db.execute(f'DELETE FROM "{tabla}"')
    db.execute('UPDATE workflow_entity SET staticData=NULL WHERE id IN (?,?)', ('clbComprobante01','clbStockBajo0001'))
    print('n8n: ejecuciones eliminadas; cursores de los dos flujos reiniciados')
