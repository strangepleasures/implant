#!/usr/bin/env node
// Deletes the compiled `out/` directory so stale files never survive a rebuild.
import { rmSync } from 'node:fs';

rmSync('out', { recursive: true, force: true });