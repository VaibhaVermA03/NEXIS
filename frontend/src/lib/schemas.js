import { z } from 'zod'

export const passwordRule = z.string()
  .min(10, 'Use at least 10 characters').max(128, 'Use at most 128 characters')
  .regex(/[a-z]/, 'Include a lowercase letter').regex(/[A-Z]/, 'Include an uppercase letter').regex(/\d/, 'Include a digit')

const email = z.string().trim().min(1, 'Email is required').email('Enter a valid email address')

export const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required') })

export const signupSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter your full name').max(120),
  email, password: passwordRule, password_confirm: z.string().min(1, 'Confirm your password'),
}).refine((d) => d.password === d.password_confirm, { path: ['password_confirm'], message: 'Passwords do not match' })

export const forgotSchema = z.object({ email })

export const resetSchema = z.object({ password: passwordRule, password_confirm: z.string().min(1, 'Confirm your password') })
  .refine((d) => d.password === d.password_confirm, { path: ['password_confirm'], message: 'Passwords do not match' })

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Enter your current password'), new_password: passwordRule, new_password_confirm: z.string().min(1, 'Confirm the new password'),
}).refine((d) => d.new_password === d.new_password_confirm, { path: ['new_password_confirm'], message: 'Passwords do not match' })

export const agentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional().default(''),
  system_instructions: z.string().max(8000, 'Keep instructions under 8000 characters').optional().default(''),
  model: z.string().trim().min(1, 'Model is required').max(64).regex(/^[A-Za-z0-9._:-]+$/, 'Letters, digits, . _ - : only'),
  temperature: z.coerce.number().min(0).max(2),
  max_steps: z.coerce.number().int().min(1).max(10),
  enabled: z.boolean(),
  tool_keys: z.array(z.string()),
})

const jsonObject = z.string().superRefine((v, ctx) => {
  try { const j = JSON.parse(v || '{}'); if (typeof j !== 'object' || Array.isArray(j) || j === null) throw new Error('not object') } catch {
    ctx.addIssue({ code: 'custom', message: 'Must be a valid JSON object' })
  }
})

export const toolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/, 'snake_case, 3–64 chars (e.g. get_weather)'),
  description: z.string().trim().min(3, 'Describe what the tool does').max(500),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().trim().min(8, 'Enter the endpoint URL').refine((u) => /^https?:\/\//i.test(u), 'URL must start with https://'),
  auth_mode: z.enum(['none', 'bearer', 'header', 'query']),
  auth_name: z.string().max(64).optional().default(''),
  headers_json: jsonObject,
  input_schema_json: jsonObject,
  timeout_seconds: z.coerce.number().int().min(1).max(30),
  enabled: z.boolean(),
  secret_value: z.string().max(2000).optional().default(''),
  clear_secret: z.boolean().optional().default(false),
}).refine((d) => !['header', 'query'].includes(d.auth_mode) || d.auth_name.trim(), { path: ['auth_name'], message: 'Required for header/query auth' })

export const apiKeySchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(80), write: z.boolean(), read: z.boolean() })
  .refine((d) => d.read || d.write, { path: ['read'], message: 'Choose at least one permission' })
