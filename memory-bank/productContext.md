# Product Context - AI Kit

## Why This Repository Exists

AI Kit is the internal backbone for reliable AI orchestration at Aidalinfo. It removes SDK volatility risk while giving teams reusable primitives for agents, workflow automation, RAG, and HTTP serving.

## Problem Statements

- Teams need reusable AI capabilities without repeatedly re-implementing orchestration glue.
- Product engineering teams need typed abstractions that survive upstream model/provider changes.
- Operations teams need observable and governable AI execution (telemetry, resume, streaming, traceability).

## User Segments

- Internal developers building AI features.
- Integrators deploying AI services via HTTP.
- Product teams needing reusable client/server contracts.

## Core Outcomes

- Faster agent/workflow delivery from tested building blocks.
- Fewer regressions when moving between provider models.
- Easier onboarding with templates and clear examples.

## UX / DX Expectations
- Strong TypeScript inference for configuration and generated payloads.
- Predictable defaults with escape hatches for advanced scenarios.
- Small, composable API surface with minimal setup.

## Business Signals to Track

- Stability of package consumers after minor/patch releases.
- Release cadence success on core/server packages.
- Adoption of new capabilities (`mcp-docs`, RAG helpers, telemetry, templates).

## Detailed References

- `memory-bank/projectbrief.md`
- `memory-bank/activeContext.md`
- `README.md`
- Package-level READMEs
