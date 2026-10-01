// load .env files the same way Next.js does (.env.local overrides .env, existing env wins)
// must be imported before anything reads process.env
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
