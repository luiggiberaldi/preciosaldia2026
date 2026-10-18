const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const PIN_HASH_PATTERN = /^pbkdf2\$\d+\$[^$]+\$[^$]+$/;

function requireUserId(value) {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0) throw new Error('Usuario inválido');
    return id;
}

function requirePinHash(value) {
    if (typeof value !== 'string' || !PIN_HASH_PATTERN.test(value)) {
        throw new Error('El PIN remoto debe llegar hasheado');
    }
    return value;
}

function requireUserName(value) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error('El nombre del usuario es obligatorio');
    return value.trim();
}

function requireRole(value) {
    if (!['CAJERO', 'ADMIN'].includes(value)) throw new Error('Rol de usuario inválido');
    return value;
}

function withoutPin(user) {
    if (!isRecord(user)) return user;
    const { pin: _pin, ...safeUser } = user;
    return safeUser;
}

function nextUserId(users) {
    return users.reduce((max, user) => Math.max(max, Number(user?.id) || 0), 0) + 1;
}

/**
 * Aplica una orden de usuarios en la caja. El comando transporta únicamente
 * hashes PBKDF2; nunca recibe un PIN en claro.
 */
export async function applySupervisorUserCommand(storage, payload = {}, { onUsersChanged } = {}) {
    if (!storage?.getItem || !storage?.setItem) throw new Error('Almacenamiento de usuarios no disponible');

    const savedAuth = await storage.getItem('abasto-auth-storage', null);
    const state = isRecord(savedAuth?.state) ? savedAuth.state : {};
    const users = Array.isArray(state.usuarios) ? state.usuarios : [];
    const action = payload.action;
    let nextUsers;
    let changedUser;

    if (action === 'add') {
        const user = {
            id: nextUserId(users),
            nombre: requireUserName(payload.nombre),
            rol: requireRole(payload.rol),
            pin: requirePinHash(payload.pinHash),
            requirePin: payload.bypassPin !== true,
        };
        nextUsers = [...users, user];
        changedUser = user;
    } else if (action === 'edit') {
        // El PIN no se cambia por canal remoto (retirado 2026-10-18): 'change_pin'
        // ya no es una acción válida y las ediciones ignoran cualquier campo de
        // PIN; solo el alta de usuarios define un PIN inicial hasheado.
        const userId = requireUserId(payload.userId);
        const index = users.findIndex(user => Number(user.id) === userId);
        if (index < 0) throw new Error('Usuario no encontrado en la caja');
        const patch = isRecord(payload.patch) ? payload.patch : {};
        const next = { ...users[index] };
        if (patch.nombre !== undefined) next.nombre = requireUserName(patch.nombre);
        if (patch.rol !== undefined) next.rol = requireRole(patch.rol);
        if (patch.bypassPin !== undefined) next.requirePin = patch.bypassPin !== true;
        changedUser = next;
        nextUsers = users.map((user, currentIndex) => currentIndex === index ? next : user);
    } else if (action === 'delete') {
        const userId = requireUserId(payload.userId);
        const target = users.find(user => Number(user.id) === userId);
        if (!target) throw new Error('Usuario no encontrado en la caja');
        const adminCount = users.filter(user => user.rol === 'ADMIN').length;
        if (target.rol === 'ADMIN' && adminCount <= 1) throw new Error('No se puede eliminar el último administrador');
        if (Number(state.usuarioActivo?.id) === userId) throw new Error('No se puede eliminar el usuario activo');
        nextUsers = users.filter(user => Number(user.id) !== userId);
        changedUser = target;
    } else {
        throw new Error('Acción de usuario inválida');
    }

    if (!savedAuth || !isRecord(savedAuth)) {
        throw new Error('La sesión de usuarios no está inicializada en la caja');
    }

    await storage.setItem('abasto-auth-storage', {
        ...savedAuth,
        state: { ...state, usuarios: nextUsers },
    });
    await storage.setItem('bodega_users_catalog_v1', nextUsers.map(withoutPin));
    onUsersChanged?.(nextUsers);

    return {
        action,
        user: withoutPin(changedUser),
        users: nextUsers.map(withoutPin),
        status: 'applied',
    };
}

export default { applySupervisorUserCommand };
