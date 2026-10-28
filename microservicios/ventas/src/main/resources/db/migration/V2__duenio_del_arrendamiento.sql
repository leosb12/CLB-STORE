-- El arrendamiento registra a su dueño: solo él puede guardar avances o liberarlo,
-- así un proceso lento cuyo arriendo venció no pisa el trabajo de quien la retomó.
alter table sagas_compra add column reclamada_por uuid;
