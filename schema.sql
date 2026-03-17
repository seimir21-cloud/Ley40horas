-- ==================================================================================================
-- BASE DE DATOS: Generador de Anexos Ley 42 Horas Chile
-- ENTORNO: Supabase / PostgreSQL
-- ==================================================================================================

-- 1. TABLA: perfiles_empresas (Gestión de Créditos)
-- Esta tabla almacena los datos comerciales de la empresa y la cantidad de anexos (créditos) que ha comprado.
CREATE TABLE public.perfiles_empresas (
    -- id hace referencia directa al usuario autenticado (auth.users)
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email_contacto TEXT NOT NULL,
    nombre_empresa TEXT,
    rut_empresa TEXT,
    -- creditos_disponibles representa el "saldo" de anexos que la empresa puede generar. Inicia en 0.
    creditos_disponibles INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- 2. TABLA: transacciones_pagos (Historial Financiero)
-- Registra todas las compras y transacciones realizadas a través de pasarelas de pago (MercadoPago, Flow, etc.)
CREATE TABLE public.transacciones_pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- empresa_id enlaza la transacción con el perfil comercial del usuario que la realizó
    empresa_id UUID NOT NULL REFERENCES public.perfiles_empresas(id) ON DELETE CASCADE,
    id_pago_pasarela TEXT UNIQUE NOT NULL,
    plan_comprado TEXT NOT NULL, -- Ej: 'Pack Pyme 5', 'Básico 1'
    monto INTEGER NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('aprobado', 'pendiente', 'rechazado')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- ==================================================================================================
-- 3. SEGURIDAD A NIVEL DE FILA (ROW LEVEL SECURITY - RLS)
-- ==================================================================================================

-- Habilitar RLS en ambas tablas (Nadie puede leer/escribir nada por defecto)
ALTER TABLE public.perfiles_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transacciones_pagos ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- POLÍTICAS PARA: perfiles_empresas
-- Un usuario autenticado solo puede ver, insertar o actualizar su propia fila (id = auth.uid())
-- -------------------------------------------------------------------------

-- Permitir al usuario LEER su propio perfil
CREATE POLICY "Permitir SELECT propio en perfiles_empresas" 
ON public.perfiles_empresas 
FOR SELECT 
USING (auth.uid() = id);

-- Permitir al usuario INSERTAR su propio perfil (por ej, al registrarse)
CREATE POLICY "Permitir INSERT propio en perfiles_empresas" 
ON public.perfiles_empresas 
FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Permitir al usuario ACTUALIZAR su propio perfil (Nombres, Ruts, etc)
-- NOTA CRÍTICA: En un escenario real, el frontend NO debería poder modificar los 'creditos_disponibles'. 
-- Esa modificación suele hacerse mediante Webhooks del servidor cuando se recibe el pago, saltándose el RLS con la Service Role Key.
CREATE POLICY "Permitir UPDATE propio en perfiles_empresas" 
ON public.perfiles_empresas 
FOR UPDATE 
USING (auth.uid() = id);

-- -------------------------------------------------------------------------
-- POLÍTICAS PARA: transacciones_pagos
-- Un usuario solo debe poder LEER el historial de sus propias transacciones.
-- -------------------------------------------------------------------------

CREATE POLICY "Permitir SELECT propias transacciones" 
ON public.transacciones_pagos 
FOR SELECT 
USING (auth.uid() = empresa_id);

-- Un usuario autenticado normalmente no inserta transacciones directamente; el backend (Webhook) lo hace.
-- Si tu flujo depende del frontend para insertar la transacción pendiente, usa esta política:
CREATE POLICY "Permitir INSERT propias transacciones" 
ON public.transacciones_pagos 
FOR INSERT 
WITH CHECK (auth.uid() = empresa_id);

-- ==================================================================================================
-- 4. FUNCIÓN ALMACENADA (RPC): consumir_credito()
-- ==================================================================================================
-- Ejecuta una deducción atómica de 1 crédito del usuario autenticado sin enviarlo desde el frontend.

CREATE OR REPLACE FUNCTION public.consumir_credito()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- Se ejecuta con permisos de creador de la base de datos para ignorar RLS internos si fuera necesario, pero lo limitamos manualmente.
AS $$
DECLARE
    creditos_actuales INTEGER;
    usuario_uid UUID;
BEGIN
    -- Capturar el ID del usuario actualmente autenticado que llama a esta función
    usuario_uid := auth.uid();

    -- Validar que haya alguien logueado
    IF usuario_uid IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado.';
    END IF;

    -- Obtener la cantidad de créditos de la empresa (bloqueando la fila para evitar "race conditions")
    SELECT creditos_disponibles INTO creditos_actuales 
    FROM public.perfiles_empresas 
    WHERE id = usuario_uid 
    FOR UPDATE;

    -- Validar si el registro de empresa existe
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Perfil de empresa no encontrado.';
    END IF;

    -- Validar que el saldo sea mayor a 0
    IF creditos_actuales <= 0 THEN
        RAISE EXCEPTION 'No tienes créditos suficientes. Por favor, compra un nuevo plan.';
    END IF;

    -- Descontar el crédito atómicamente de forma segura
    UPDATE public.perfiles_empresas
    SET creditos_disponibles = creditos_disponibles - 1
    WHERE id = usuario_uid;

    -- Retornar verdadero al frontend si el consumo fue exitoso
    RETURN TRUE;
END;
$$;