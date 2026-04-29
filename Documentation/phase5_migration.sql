-- ============================================================
-- Growthic One — Phase 5 Migration
-- Adds entity_id to reimbursements for client-entity tracking
-- Safe to run multiple times (IF NOT EXISTS / IF EXISTS guards)
-- ============================================================

ALTER TABLE public.reimbursements
  ADD COLUMN IF NOT EXISTS entity_id UUID
    REFERENCES public.client_entities(id) ON DELETE SET NULL;
