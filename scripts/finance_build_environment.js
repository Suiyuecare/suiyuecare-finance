#!/usr/bin/env node
'use strict';

const BUILD_TARGET_PLACEHOLDER = "'__FINANCE_BUILD_TARGET__'";
const SUPABASE_URL_PLACEHOLDER = "'__FINANCE_SUPABASE_URL__'";
const SUPABASE_ANON_KEY_PLACEHOLDER = "'__FINANCE_SUPABASE_ANON_KEY__'";
const DEMO_LOGIN_PATTERN = /\s*<!-- DEMO_LOGIN_START -->[\s\S]*?<!-- DEMO_LOGIN_END -->\s*/g;
const VALID_BUILD_TARGETS = new Set(['production', 'preview', 'local']);

function value(env, name) {
  return String((env && env[name]) || '').trim();
}

function vercelTarget(raw) {
  if (!raw) return '';
  if (raw === 'production' || raw === 'preview') return raw;
  if (raw === 'development') return 'local';
  throw new Error(`unknown VERCEL_ENV: ${raw}`);
}

function resolveBuildTarget(env = process.env) {
  const explicit = value(env, 'FINANCE_BUILD_TARGET').toLowerCase();
  const fromVercel = vercelTarget(value(env, 'VERCEL_ENV').toLowerCase());
  if (explicit && !VALID_BUILD_TARGETS.has(explicit)) {
    throw new Error(`unknown FINANCE_BUILD_TARGET: ${explicit}`);
  }
  if (explicit && fromVercel && explicit !== fromVercel) {
    throw new Error(`FINANCE_BUILD_TARGET ${explicit} conflicts with VERCEL_ENV ${fromVercel}`);
  }
  return explicit || fromVercel || 'local';
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function validateProductionSupabaseConfig(env) {
  const rawUrl = value(env, 'FINANCE_SUPABASE_URL');
  const anonKey = value(env, 'FINANCE_SUPABASE_ANON_KEY');
  if (!rawUrl || !anonKey) {
    throw new Error('production build requires FINANCE_SUPABASE_URL and FINANCE_SUPABASE_ANON_KEY');
  }
  if (/__FINANCE_[A-Z0-9_]+__/.test(rawUrl) || /__FINANCE_[A-Z0-9_]+__/.test(anonKey)) {
    throw new Error('production Supabase configuration still contains a build placeholder');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    throw new Error('FINANCE_SUPABASE_URL must be a complete HTTPS Supabase URL');
  }
  if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) {
    throw new Error('FINANCE_SUPABASE_URL must use an HTTPS *.supabase.co host');
  }
  if (parsed.username || parsed.password || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('FINANCE_SUPABASE_URL must be a credential-free project origin');
  }

  if (/^sb_secret_/i.test(anonKey) || /service[_-]?role/i.test(anonKey)) {
    throw new Error('secret or service-role Supabase keys are forbidden in the Finance browser build');
  }
  const jwtPayload = decodeJwtPayload(anonKey);
  if (jwtPayload) {
    if (jwtPayload.role !== 'anon') {
      throw new Error('legacy Supabase browser JWT must have the anon role');
    }
    const projectRef = parsed.hostname.split('.')[0];
    if (jwtPayload.ref && jwtPayload.ref !== projectRef) {
      throw new Error('FINANCE_SUPABASE_ANON_KEY does not belong to FINANCE_SUPABASE_URL');
    }
  } else if (!/^sb_publishable_[A-Za-z0-9._-]{8,}$/i.test(anonKey)) {
    throw new Error('FINANCE_SUPABASE_ANON_KEY must be an anon JWT or sb_publishable key');
  }

  return {
    supabaseUrl: parsed.origin,
    supabaseAnonKey: anonKey
  };
}

function resolveBuildConfig(env = process.env) {
  const target = resolveBuildTarget(env);
  if (target === 'production') {
    const production = validateProductionSupabaseConfig(env);
    return {
      target,
      runtimeMode: 'production-supabase',
      supabaseUrl: production.supabaseUrl,
      supabaseAnonKey: production.supabaseAnonKey
    };
  }
  return {
    target,
    runtimeMode: 'offline-demo',
    supabaseUrl: '',
    supabaseAnonKey: ''
  };
}

function replaceExactlyOnce(source, placeholder, replacement) {
  const first = source.indexOf(placeholder);
  const last = source.lastIndexOf(placeholder);
  if (first < 0 || first !== last) {
    throw new Error(`expected exactly one ${placeholder} placeholder in index.html`);
  }
  return source.slice(0, first) + replacement + source.slice(first + placeholder.length);
}

function applyBuildEnvironment(source, config) {
  let html = String(source || '');
  if (config.target === 'production') {
    html = html.replace(DEMO_LOGIN_PATTERN, '\n');
  }
  html = replaceExactlyOnce(html, BUILD_TARGET_PLACEHOLDER, JSON.stringify(config.target));
  html = replaceExactlyOnce(html, SUPABASE_URL_PLACEHOLDER, JSON.stringify(config.supabaseUrl));
  html = replaceExactlyOnce(html, SUPABASE_ANON_KEY_PLACEHOLDER, JSON.stringify(config.supabaseAnonKey));

  if (/__(?:FINANCE_BUILD_TARGET|FINANCE_SUPABASE_URL|FINANCE_SUPABASE_ANON_KEY)__/.test(html)) {
    throw new Error('Finance runtime configuration placeholder remains after build');
  }
  if (config.target !== 'production') {
    if (/https:\/\/[a-z0-9-]+\.supabase\.co/i.test(html)) {
      throw new Error(`${config.target} artifact contains a Supabase project URL`);
    }
    if (/var\s+SUPABASE_(?:ANON|PUBLISHABLE)_KEY\s*=\s*['"](?:eyJ|sb_)/i.test(html)) {
      throw new Error(`${config.target} artifact contains a Supabase browser key`);
    }
  }
  if (/sb_secret_|service[_-]?role[^\n]{0,80}(?:eyJ|sb_)/i.test(html)) {
    throw new Error('browser artifact contains a forbidden Supabase elevated key');
  }
  return html;
}

module.exports = {
  BUILD_TARGET_PLACEHOLDER,
  SUPABASE_URL_PLACEHOLDER,
  SUPABASE_ANON_KEY_PLACEHOLDER,
  applyBuildEnvironment,
  resolveBuildConfig,
  resolveBuildTarget,
  validateProductionSupabaseConfig
};
