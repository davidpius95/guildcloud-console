// AUTO-GENERATED from the live Supabase schema (project ssbleuvjxlgttlkoancu).
// Regenerate after every migration: see docs/phase-1/operator-runbook.md.
// Do not hand-edit.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      access_grants: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          membership_id: string
          organization_id: string
          project_id: string
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id: string
          organization_id: string
          project_id: string
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id?: string
          organization_id?: string
          project_id?: string
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_grants_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          metadata: Json
          organization_id: string
          project_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          metadata?: Json
          organization_id: string
          project_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          metadata?: Json
          organization_id?: string
          project_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_reservations: {
        Row: {
          created_at: string
          disk_gb: number
          expires_at: string
          id: string
          memory_gb: number
          node: string
          operation_id: string
          site_id: string
          state: string
          vcpu: number
        }
        Insert: {
          created_at?: string
          disk_gb: number
          expires_at?: string
          id?: string
          memory_gb: number
          node: string
          operation_id: string
          site_id: string
          state?: string
          vcpu: number
        }
        Update: {
          created_at?: string
          disk_gb?: number
          expires_at?: string
          id?: string
          memory_gb?: number
          node?: string
          operation_id?: string
          site_id?: string
          state?: string
          vcpu?: number
        }
        Relationships: [
          {
            foreignKeyName: "capacity_reservations_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_image_site_templates: {
        Row: {
          catalog_image_id: string
          proxmox_node: string
          proxmox_storage: string
          proxmox_vmid: number
          site_id: string
        }
        Insert: {
          catalog_image_id: string
          proxmox_node: string
          proxmox_storage: string
          proxmox_vmid: number
          site_id: string
        }
        Update: {
          catalog_image_id?: string
          proxmox_node?: string
          proxmox_storage?: string
          proxmox_vmid?: number
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_image_site_templates_catalog_image_id_fkey"
            columns: ["catalog_image_id"]
            isOneToOne: false
            referencedRelation: "catalog_images"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_images: {
        Row: {
          available_sites: string[]
          created_at: string
          family: string
          id: string
          name: string
          recommended: boolean
          version: string
        }
        Insert: {
          available_sites?: string[]
          created_at?: string
          family: string
          id: string
          name: string
          recommended?: boolean
          version: string
        }
        Update: {
          available_sites?: string[]
          created_at?: string
          family?: string
          id?: string
          name?: string
          recommended?: boolean
          version?: string
        }
        Relationships: []
      }
      catalog_plans: {
        Row: {
          created_at: string
          disk_gb: number
          hourly_price: number
          id: string
          is_placeholder: boolean
          memory_gb: number
          monthly_max: number
          name: string
          note: string | null
          vcpu: number
        }
        Insert: {
          created_at?: string
          disk_gb: number
          hourly_price: number
          id: string
          is_placeholder?: boolean
          memory_gb: number
          monthly_max: number
          name: string
          note?: string | null
          vcpu: number
        }
        Update: {
          created_at?: string
          disk_gb?: number
          hourly_price?: number
          id?: string
          is_placeholder?: boolean
          memory_gb?: number
          monthly_max?: number
          name?: string
          note?: string | null
          vcpu?: number
        }
        Relationships: []
      }
      instance_snapshots: {
        Row: {
          created_at: string
          id: string
          instance_id: string
          name: string
          organization_id: string
          project_id: string
          proxmox_snapname: string
          size_bytes: number | null
          state: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_id: string
          name: string
          organization_id: string
          project_id: string
          proxmox_snapname: string
          size_bytes?: number | null
          state?: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_id?: string
          name?: string
          organization_id?: string
          project_id?: string
          proxmox_snapname?: string
          size_bytes?: number | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "instance_snapshots_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instance_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instance_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      instances: {
        Row: {
          catalog_image_id: string
          catalog_plan_id: string
          // Placement fields. Set by place_next_pending_operation() (create)
          // or the worker itself (proxmox_node/storage_id, once a VM
          // exists). Internal only - see queries.ts for the customer-facing
          // shape, which must never surface these.
          cluster_id: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          password_ssh_enabled: boolean
          private_hostname: string | null
          private_ip: unknown
          project_id: string
          proxmox_node: string | null
          proxmox_vmid: number | null
          site_id: string
          ssh_keys_sync_pending: boolean
          state: string
          storage_id: string | null
          tailscale_device_id: string | null
        }
        Insert: {
          catalog_image_id: string
          catalog_plan_id: string
          cluster_id?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          password_ssh_enabled?: boolean
          private_hostname?: string | null
          private_ip?: unknown
          project_id: string
          proxmox_node?: string | null
          proxmox_vmid?: number | null
          site_id: string
          ssh_keys_sync_pending?: boolean
          state?: string
          storage_id?: string | null
          tailscale_device_id?: string | null
        }
        Update: {
          catalog_image_id?: string
          catalog_plan_id?: string
          cluster_id?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          password_ssh_enabled?: boolean
          private_hostname?: string | null
          private_ip?: unknown
          project_id?: string
          proxmox_node?: string | null
          proxmox_vmid?: number | null
          site_id?: string
          ssh_keys_sync_pending?: boolean
          state?: string
          storage_id?: string | null
          tailscale_device_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instances_catalog_image_id_fkey"
            columns: ["catalog_image_id"]
            isOneToOne: false
            referencedRelation: "catalog_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instances_catalog_plan_id_fkey"
            columns: ["catalog_plan_id"]
            isOneToOne: false
            referencedRelation: "catalog_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          device_enrolled: boolean
          email: string | null
          enrollment_token: string | null
          enrollment_token_expires_at: string | null
          id: string
          invite_token: string | null
          invite_token_expires_at: string | null
          invited_at: string | null
          invited_by: string | null
          invited_email: string | null
          joined_at: string | null
          last_active_at: string | null
          organization_id: string
          role: string
          tailscale_device_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device_enrolled?: boolean
          email?: string | null
          enrollment_token?: string | null
          enrollment_token_expires_at?: string | null
          id?: string
          invite_token?: string | null
          invite_token_expires_at?: string | null
          invited_at?: string | null
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          last_active_at?: string | null
          organization_id: string
          role: string
          tailscale_device_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device_enrolled?: boolean
          email?: string | null
          enrollment_token?: string | null
          enrollment_token_expires_at?: string | null
          id?: string
          invite_token?: string | null
          invite_token_expires_at?: string | null
          invited_at?: string | null
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          last_active_at?: string | null
          organization_id?: string
          role?: string
          tailscale_device_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_stages: {
        Row: {
          attempt: number
          detail: Json
          error: string | null
          finished_at: string | null
          id: string
          operation_id: string
          stage: string
          started_at: string | null
          status: string
        }
        Insert: {
          attempt?: number
          detail?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          operation_id: string
          stage: string
          started_at?: string | null
          status?: string
        }
        Update: {
          attempt?: number
          detail?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          operation_id?: string
          stage?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_stages_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "operations"
            referencedColumns: ["id"]
          },
        ]
      }
      operations: {
        Row: {
          current_stage: string | null
          ended_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          instance_id: string | null
          kind: string
          organization_id: string
          project_id: string | null
          resource_name: string
          site_id: string
          stages: Json
          started_at: string
          state: string
          updated_at: string
        }
        Insert: {
          current_stage?: string | null
          ended_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          instance_id?: string | null
          kind: string
          organization_id: string
          project_id?: string | null
          resource_name: string
          site_id?: string
          stages?: Json
          started_at?: string
          state?: string
          updated_at?: string
        }
        Update: {
          current_stage?: string | null
          ended_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          instance_id?: string | null
          kind?: string
          organization_id?: string
          project_id?: string | null
          resource_name?: string
          site_id?: string
          stages?: Json
          started_at?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          slug: string
          wallet_balance_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          slug: string
          wallet_balance_cents?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          wallet_balance_cents?: number
        }
        Relationships: []
      }
      projects: {
        Row: {
          accent: string
          created_at: string
          description: string
          id: string
          name: string
          organization_id: string
          slug: string
          tailscale_acl_state: string
        }
        Insert: {
          accent?: string
          created_at?: string
          description?: string
          id?: string
          name: string
          organization_id: string
          slug: string
          tailscale_acl_state?: string
        }
        Update: {
          accent?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          organization_id?: string
          slug?: string
          tailscale_acl_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ssh_keys: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          public_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          public_key: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          public_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ssh_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: undefined }
      catalog_image_site_availability: {
        Args: Record<PropertyKey, never>
        Returns: {
          catalog_image_id: string
          site_id: string
        }[]
      }
      can_provision_instance: {
        Args: {
          p_catalog_image_id: string
          p_catalog_plan_id: string
          p_site_id: string
        }
        Returns: {
          eligible: boolean
          message: string
        }[]
      }
      describe_instance_enrollment_link: {
        Args: { p_token: string }
        Returns: {
          instance_name: string
          expires_at: string
          instance_ready: boolean
        }[]
      }
      get_invite_by_token: {
        Args: { p_token: string }
        Returns: {
          email: string
          organization_name: string
        }[]
      }
      get_vault_secret: { Args: { secret_name: string }; Returns: string }
      has_org_role: {
        Args: { p_org_id: string; p_roles: string[] }
        Returns: boolean
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      log_audit_event: {
        Args: {
          p_action: string
          p_metadata?: Json
          p_organization_id: string
          p_project_id?: string
          p_target_id?: string
          p_target_type?: string
        }
        Returns: number
      }
      mark_org_instances_ssh_dirty: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      redeem_enrollment_token: { Args: { p_token: string }; Returns: string }
      begin_instance_operation: {
        Args: { p_instance_id: string; p_state: string }
        Returns: boolean
      }
      end_instance_operation: {
        Args: { p_instance_id: string }
        Returns: undefined
      }
      request_instance_deletion: {
        Args: { p_idempotency_key: string; p_instance_id: string }
        Returns: string
      }
      request_instance_create: {
        Args: {
          p_catalog_image_id: string
          p_catalog_plan_id: string
          p_idempotency_key: string
          p_instance_id: string
          p_name: string
          p_operation_id: string
          p_password_ssh_enabled: boolean
          p_project_id: string
          p_site_id: string
        }
        Returns: {
          instance_id: string
          operation_id: string
          replayed: boolean
        }[]
      }
      request_instance_resize: {
        Args: {
          p_idempotency_key: string
          p_instance_id: string
          p_target_plan_id: string
        }
        Returns: string
      }
      request_instance_restore_replace: {
        Args: {
          p_idempotency_key: string
          p_instance_id: string
          p_snapshot_id: string
        }
        Returns: string
      }
      request_instance_snapshot: {
        Args: {
          p_idempotency_key: string
          p_instance_id: string
          p_name: string
        }
        Returns: string
      }
      reveal_instance_ssh_password: {
        Args: { p_instance_id: string }
        Returns: string
      }
      set_vault_secret: {
        Args: { p_secret_name: string; p_secret_value: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
