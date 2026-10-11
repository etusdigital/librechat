export const CHAT = 'https://chat.etus.test';
export const IDP_HOST = 'idp.etus.test';
export const HUB_ADMIN = 'http://fake-idp-hub:4003';
export const FAKE_LLM = 'http://fake-llm:4799';
export const NGINX_LOG = '/logs/nginx.log';
export const STATE_DIR = '/state';
export const PROJECT_LINE_PREFIX = '[Projeto Etus Design]: ';

export type Persona = 'ana' | 'bia' | 'carla' | 'davi' | 'eva';
export const emailOf = (persona: Persona) => `${persona}@etus.test`;
export const subOf = (persona: Persona) => `logto-${persona}`;
