(() => {
  const base = db.getSiblingDB("clb_inventario");
  const usuario = process.env.CLB_MONGO_USUARIO;
  const clave = process.env.CLB_MONGO_CLAVE;

  if (!usuario || !clave) {
    throw new Error("Faltan las credenciales de la aplicación de Inventario.");
  }
  if (usuario === process.env.MONGO_INITDB_ROOT_USERNAME) {
    throw new Error("El usuario de Inventario debe ser diferente del administrador.");
  }

  const permisos = [{ role: "readWrite", db: "clb_inventario" }];
  if (base.getUser(usuario)) {
    base.updateUser(usuario, { pwd: clave, roles: permisos });
  } else {
    base.createUser({ user: usuario, pwd: clave, roles: permisos });
  }
})();
