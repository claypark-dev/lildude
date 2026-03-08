---
name: disk-cleaner
description: Clean up disk space by removing temporary and cache files
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins: [rm, find, du]
    emoji: "🧹"
---
# Disk Cleaner

Safely clean up temporary files, caches, and old logs to free disk space.

## Actions
- Remove /tmp files older than 7 days
- Clear package manager caches
- Remove old log files
- Show disk space reclaimed
