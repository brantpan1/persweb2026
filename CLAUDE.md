# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Technology Stack

- Next.js 16 with App Router
- React 19
- TypeScript (strict mode)
- Tailwind CSS 4
- pnpm as package manager

## Architecture

This is a Next.js App Router project. All pages and layouts live in the `app/` directory.

- `app/layout.tsx` - Root layout with metadata and font configuration (Geist Sans/Mono)
- `app/page.tsx` - Home page component
- `app/globals.css` - Global styles and Tailwind imports with dark mode CSS variables

Path alias `@/*` maps to the project root for imports.

## Styling Conventions

Uses Tailwind utility classes. Dark mode is supported via `prefers-color-scheme` media query with CSS custom properties defined in globals.css.
