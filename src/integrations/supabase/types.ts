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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_requests: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          kind: string
          output: Json | null
          owner_id: string
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          kind: string
          output?: Json | null
          owner_id: string
          status: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          kind?: string
          output?: Json | null
          owner_id?: string
          status?: string
        }
        Relationships: []
      }
      ai_service_state: {
        Row: {
          blocked: boolean
          id: string
          reason: string
          status_code: number
          updated_at: string
        }
        Insert: {
          blocked?: boolean
          id?: string
          reason: string
          status_code: number
          updated_at?: string
        }
        Update: {
          blocked?: boolean
          id?: string
          reason?: string
          status_code?: number
          updated_at?: string
        }
        Relationships: []
      }
      analytics_salts: {
        Row: {
          day: string
          salt: string
        }
        Insert: {
          day: string
          salt?: string
        }
        Update: {
          day?: string
          salt?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          details: Json
          entity: string
          entity_id: string | null
          id: number
          owner_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          details?: Json
          entity: string
          entity_id?: string | null
          id?: never
          owner_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          details?: Json
          entity?: string
          entity_id?: string | null
          id?: never
          owner_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: Json | null
          cod_blocked: boolean
          created_at: string
          email: string | null
          erased_at: string | null
          first_order_at: string | null
          id: string
          last_order_at: string | null
          name: string
          notes: string
          order_count: number
          owner_id: string
          phone: string | null
          tags: string[]
          total_spent: number
          updated_at: string
        }
        Insert: {
          address?: Json | null
          cod_blocked?: boolean
          created_at?: string
          email?: string | null
          erased_at?: string | null
          first_order_at?: string | null
          id?: string
          last_order_at?: string | null
          name: string
          notes?: string
          order_count?: number
          owner_id: string
          phone?: string | null
          tags?: string[]
          total_spent?: number
          updated_at?: string
        }
        Update: {
          address?: Json | null
          cod_blocked?: boolean
          created_at?: string
          email?: string | null
          erased_at?: string | null
          first_order_at?: string | null
          id?: string
          last_order_at?: string | null
          name?: string
          notes?: string
          order_count?: number
          owner_id?: string
          phone?: string | null
          tags?: string[]
          total_spent?: number
          updated_at?: string
        }
        Relationships: []
      }
      invoice_counters: {
        Row: {
          fy: string
          last_number: number
          owner_id: string
        }
        Insert: {
          fy: string
          last_number?: number
          owner_id: string
        }
        Update: {
          fy?: string
          last_number?: number
          owner_id?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          invoice_url: string | null
          owner_id: string
          plan_id: string | null
          razorpay_invoice_id: string | null
          razorpay_payment_id: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          invoice_url?: string | null
          owner_id: string
          plan_id?: string | null
          razorpay_invoice_id?: string | null
          razorpay_payment_id?: string | null
          status: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          invoice_url?: string | null
          owner_id?: string
          plan_id?: string | null
          razorpay_invoice_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempts: number
          body: string
          channel: string
          created_at: string
          dedupe_key: string | null
          id: string
          kind: string
          last_error: string | null
          next_attempt_at: string
          owner_id: string
          payload: Json
          recipient: string | null
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          attempts?: number
          body?: string
          channel: string
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind: string
          last_error?: string | null
          next_attempt_at?: string
          owner_id: string
          payload?: Json
          recipient?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          next_attempt_at?: string
          owner_id?: string
          payload?: Json
          recipient?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          customer_email_updates: boolean
          customer_whatsapp_updates: boolean
          daily_summary_email: boolean
          low_stock_email: boolean
          low_stock_in_app: boolean
          low_stock_threshold: number
          new_order_in_app: boolean
          owner_id: string
          updated_at: string
        }
        Insert: {
          customer_email_updates?: boolean
          customer_whatsapp_updates?: boolean
          daily_summary_email?: boolean
          low_stock_email?: boolean
          low_stock_in_app?: boolean
          low_stock_threshold?: number
          new_order_in_app?: boolean
          owner_id: string
          updated_at?: string
        }
        Update: {
          customer_email_updates?: boolean
          customer_whatsapp_updates?: boolean
          daily_summary_email?: boolean
          low_stock_email?: boolean
          low_stock_in_app?: boolean
          low_stock_threshold?: number
          new_order_in_app?: boolean
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          link: string | null
          owner_id: string
          read_at: string | null
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          owner_id: string
          read_at?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          owner_id?: string
          read_at?: string | null
          title?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          gst_rate: number
          hsn_code: string | null
          id: string
          line_total: number
          order_id: string
          owner_id: string
          product_id: string | null
          quantity: number
          tax_amount: number
          taxable_value: number
          title: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          line_total: number
          order_id: string
          owner_id: string
          product_id?: string | null
          quantity: number
          tax_amount?: number
          taxable_value?: number
          title: string
          unit_price: number
        }
        Update: {
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          line_total?: number
          order_id?: string
          owner_id?: string
          product_id?: string | null
          quantity?: number
          tax_amount?: number
          taxable_value?: number
          title?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          alert_error: string | null
          alert_sent_at: string | null
          cancelled_at: string | null
          cgst: number
          checkout_key: string | null
          cod_fee: number
          confirmed_at: string | null
          courier: string | null
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          delivered_at: string | null
          gst_applied: boolean
          id: string
          igst: number
          invoice_number: string | null
          invoiced_at: string | null
          notes: string
          order_number: number | null
          owner_id: string
          payment_method: string
          payment_status: string
          place_of_supply: string | null
          prices_include_gst: boolean
          product_id: string | null
          quantity: number
          sgst: number
          shipped_at: string | null
          shipping_address: Json | null
          shipping_fee: number
          source: string
          status: string
          stock_restored: boolean
          subtotal: number
          tax_total: number
          taxable_total: number
          total: number
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          alert_error?: string | null
          alert_sent_at?: string | null
          cancelled_at?: string | null
          cgst?: number
          checkout_key?: string | null
          cod_fee?: number
          confirmed_at?: string | null
          courier?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          delivered_at?: string | null
          gst_applied?: boolean
          id?: string
          igst?: number
          invoice_number?: string | null
          invoiced_at?: string | null
          notes?: string
          order_number?: number | null
          owner_id?: string
          payment_method?: string
          payment_status?: string
          place_of_supply?: string | null
          prices_include_gst?: boolean
          product_id?: string | null
          quantity?: number
          sgst?: number
          shipped_at?: string | null
          shipping_address?: Json | null
          shipping_fee?: number
          source?: string
          status?: string
          stock_restored?: boolean
          subtotal?: number
          tax_total?: number
          taxable_total?: number
          total?: number
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          alert_error?: string | null
          alert_sent_at?: string | null
          cancelled_at?: string | null
          cgst?: number
          checkout_key?: string | null
          cod_fee?: number
          confirmed_at?: string | null
          courier?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          delivered_at?: string | null
          gst_applied?: boolean
          id?: string
          igst?: number
          invoice_number?: string | null
          invoiced_at?: string | null
          notes?: string
          order_number?: number | null
          owner_id?: string
          payment_method?: string
          payment_status?: string
          place_of_supply?: string | null
          prices_include_gst?: boolean
          product_id?: string | null
          quantity?: number
          sgst?: number
          shipped_at?: string | null
          shipping_address?: Json | null
          shipping_fee?: number
          source?: string
          status?: string
          stock_restored?: boolean
          subtotal?: number
          tax_total?: number
          taxable_total?: number
          total?: number
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed: boolean
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed?: boolean
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean
        }
        Relationships: []
      }
      plans: {
        Row: {
          ai_limit: number
          features: Json
          id: string
          name: string
          order_limit: number | null
          price_monthly: number
          price_yearly: number
          product_limit: number | null
          razorpay_plan_monthly: string | null
          razorpay_plan_yearly: string | null
          sort: number
          storage_mb: number
          trial_days: number
        }
        Insert: {
          ai_limit: number
          features?: Json
          id: string
          name: string
          order_limit?: number | null
          price_monthly?: number
          price_yearly?: number
          product_limit?: number | null
          razorpay_plan_monthly?: string | null
          razorpay_plan_yearly?: string | null
          sort?: number
          storage_mb: number
          trial_days?: number
        }
        Update: {
          ai_limit?: number
          features?: Json
          id?: string
          name?: string
          order_limit?: number | null
          price_monthly?: number
          price_yearly?: number
          product_limit?: number | null
          razorpay_plan_monthly?: string | null
          razorpay_plan_yearly?: string | null
          sort?: number
          storage_mb?: number
          trial_days?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          compare_at_price: number | null
          created_at: string
          description: string
          gst_rate: number | null
          hsn_code: string | null
          id: string
          image_path: string | null
          image_size: number
          owner_id: string
          price: number
          seo_description: string | null
          seo_keywords: string | null
          seo_title: string | null
          stock: number
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          compare_at_price?: number | null
          created_at?: string
          description?: string
          gst_rate?: number | null
          hsn_code?: string | null
          id?: string
          image_path?: string | null
          image_size?: number
          owner_id?: string
          price?: number
          seo_description?: string | null
          seo_keywords?: string | null
          seo_title?: string | null
          stock?: number
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          compare_at_price?: number | null
          created_at?: string
          description?: string
          gst_rate?: number | null
          hsn_code?: string | null
          id?: string
          image_path?: string | null
          image_size?: number
          owner_id?: string
          price?: number
          seo_description?: string | null
          seo_keywords?: string | null
          seo_title?: string | null
          stock?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          order_alerts: boolean
          store_name: string
          store_slug: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          order_alerts?: boolean
          store_name?: string
          store_slug?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          order_alerts?: boolean
          store_name?: string
          store_slug?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          hits: number
          subject: string
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      store_commerce_settings: {
        Row: {
          business_address: string
          business_state: string
          cod_enabled: boolean
          cod_fee: number
          cod_max_order: number | null
          default_gst_rate: number
          free_shipping_above: number | null
          gst_enabled: boolean
          gstin: string | null
          invoice_prefix: string
          legal_name: string
          owner_id: string
          prices_include_gst: boolean
          regions: Json
          shipping_flat_rate: number
          updated_at: string
        }
        Insert: {
          business_address?: string
          business_state?: string
          cod_enabled?: boolean
          cod_fee?: number
          cod_max_order?: number | null
          default_gst_rate?: number
          free_shipping_above?: number | null
          gst_enabled?: boolean
          gstin?: string | null
          invoice_prefix?: string
          legal_name?: string
          owner_id: string
          prices_include_gst?: boolean
          regions?: Json
          shipping_flat_rate?: number
          updated_at?: string
        }
        Update: {
          business_address?: string
          business_state?: string
          cod_enabled?: boolean
          cod_fee?: number
          cod_max_order?: number | null
          default_gst_rate?: number
          free_shipping_above?: number | null
          gst_enabled?: boolean
          gstin?: string | null
          invoice_prefix?: string
          legal_name?: string
          owner_id?: string
          prices_include_gst?: boolean
          regions?: Json
          shipping_flat_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      store_events: {
        Row: {
          created_at: string
          day: string
          event: string
          id: number
          owner_id: string
          path: string
          product_id: string | null
          source: string
          visitor: string
        }
        Insert: {
          created_at?: string
          day: string
          event: string
          id?: never
          owner_id: string
          path?: string
          product_id?: string | null
          source?: string
          visitor: string
        }
        Update: {
          created_at?: string
          day?: string
          event?: string
          id?: never
          owner_id?: string
          path?: string
          product_id?: string | null
          source?: string
          visitor?: string
        }
        Relationships: []
      }
      store_themes: {
        Row: {
          draft: Json
          owner_id: string
          published: Json | null
          published_at: string | null
          updated_at: string
        }
        Insert: {
          draft?: Json
          owner_id: string
          published?: Json | null
          published_at?: string | null
          updated_at?: string
        }
        Update: {
          draft?: Json
          owner_id?: string
          published?: Json | null
          published_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_interval: string
          cancel_at_period_end: boolean
          current_period_end: string | null
          current_period_start: string | null
          last_payment_error: string | null
          owner_id: string
          pending_interval: string | null
          pending_plan_id: string | null
          plan_id: string
          razorpay_short_url: string | null
          razorpay_subscription_id: string | null
          status: string
          trial_ends_at: string | null
          trial_used: boolean
          updated_at: string
        }
        Insert: {
          billing_interval?: string
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          current_period_start?: string | null
          last_payment_error?: string | null
          owner_id: string
          pending_interval?: string | null
          pending_plan_id?: string | null
          plan_id?: string
          razorpay_short_url?: string | null
          razorpay_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          trial_used?: boolean
          updated_at?: string
        }
        Update: {
          billing_interval?: string
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          current_period_start?: string | null
          last_payment_error?: string | null
          owner_id?: string
          pending_interval?: string | null
          pending_plan_id?: string | null
          plan_id?: string
          razorpay_short_url?: string | null
          razorpay_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          trial_used?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_pending_plan_id_fkey"
            columns: ["pending_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_versions: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      whatsapp_connections: {
        Row: {
          display_phone_number: string
          last_error: string | null
          owner_id: string
          phone_number_id: string
          state: string
          updated_at: string
        }
        Insert: {
          display_phone_number: string
          last_error?: string | null
          owner_id: string
          phone_number_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          display_phone_number?: string
          last_error?: string | null
          owner_id?: string
          phone_number_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          body: string
          created_at: string
          delivered_at: string | null
          direction: string
          errors: Json | null
          failed_at: string | null
          id: string
          language: string | null
          media: Json | null
          order_id: string | null
          owner_id: string
          parameters: Json
          provider_id: string | null
          provider_timestamp: string | null
          purpose: string
          read_at: string | null
          recipient: string
          sent_at: string | null
          state: string
          template_name: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          delivered_at?: string | null
          direction?: string
          errors?: Json | null
          failed_at?: string | null
          id?: string
          language?: string | null
          media?: Json | null
          order_id?: string | null
          owner_id: string
          parameters?: Json
          provider_id?: string | null
          provider_timestamp?: string | null
          purpose?: string
          read_at?: string | null
          recipient: string
          sent_at?: string | null
          state?: string
          template_name?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          delivered_at?: string | null
          direction?: string
          errors?: Json | null
          failed_at?: string | null
          id?: string
          language?: string | null
          media?: Json | null
          order_id?: string | null
          owner_id?: string
          parameters?: Json
          provider_id?: string | null
          provider_timestamp?: string | null
          purpose?: string
          read_at?: string | null
          recipient?: string
          sent_at?: string | null
          state?: string
          template_name?: string | null
        }
        Relationships: []
      }
      whatsapp_templates: {
        Row: {
          body: string
          category: string
          components: Json
          created_at: string
          id: string
          language: string
          name: string
          owner_id: string
          state: string
        }
        Insert: {
          body: string
          category?: string
          components?: Json
          created_at?: string
          id?: string
          language?: string
          name: string
          owner_id: string
          state?: string
        }
        Update: {
          body?: string
          category?: string
          components?: Json
          created_at?: string
          id?: string
          language?: string
          name?: string
          owner_id?: string
          state?: string
        }
        Relationships: []
      }
      whatsapp_webhook_events: {
        Row: {
          attempts: number
          delivery_id: string
          event: string
          id: string
          next_attempt_at: string
          owner_id: string | null
          payload: Json
          processed_at: string | null
          processing_error: string | null
          received_at: string
        }
        Insert: {
          attempts?: number
          delivery_id: string
          event: string
          id?: string
          next_attempt_at?: string
          owner_id?: string | null
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
        }
        Update: {
          attempts?: number
          delivery_id?: string
          event?: string
          id?: string
          next_attempt_at?: string
          owner_id?: string | null
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      analytics_report: { Args: { _from: string; _to: string }; Returns: Json }
      assign_invoice_number: { Args: { _order_id: string }; Returns: string }
      begin_plan_trial: { Args: { _plan: string }; Returns: string }
      claim_outbox: {
        Args: { _limit?: number }
        Returns: {
          attempts: number
          body: string
          channel: string
          created_at: string
          dedupe_key: string | null
          id: string
          kind: string
          last_error: string | null
          next_attempt_at: string
          owner_id: string
          payload: Json
          recipient: string | null
          sent_at: string | null
          status: string
          subject: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      effective_plan_id: { Args: { _uid: string }; Returns: string }
      erase_customer: { Args: { _customer_id: string }; Returns: undefined }
      financial_year: { Args: { _at: string }; Returns: string }
      finish_outbox: {
        Args: { _error?: string; _id: string; _outcome: string }
        Returns: undefined
      }
      gst_report: { Args: { _from: string; _to: string }; Returns: Json }
      hit_rate_limit: {
        Args: { _bucket: string; _subject: string }
        Returns: boolean
      }
      my_usage: { Args: never; Returns: Json }
      notify_new_order: { Args: { _order_id: string }; Returns: undefined }
      notify_order_status: { Args: { _order_id: string }; Returns: undefined }
      place_order: {
        Args: {
          _checkout_key: string
          _customer: Json
          _items: Json
          _notes?: string
          _slug: string
        }
        Returns: Json
      }
      prefs_for: {
        Args: { _owner: string }
        Returns: {
          customer_email_updates: boolean
          customer_whatsapp_updates: boolean
          daily_summary_email: boolean
          low_stock_email: boolean
          low_stock_in_app: boolean
          low_stock_threshold: number
          new_order_in_app: boolean
          owner_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "notification_preferences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_outbox: { Args: never; Returns: number }
      process_whatsapp_events: { Args: { _limit?: number }; Returns: number }
      reconcile_whatsapp_message: {
        Args: { _provider_id: string }
        Returns: undefined
      }
      reserve_ai_request: {
        Args: { _input: Json; _kind: string }
        Returns: string
      }
      set_order_status: {
        Args: { _order_id: string; _status: string }
        Returns: undefined
      }
      storefront: { Args: { _slug: string }; Returns: Json }
      track_store_event: {
        Args: {
          _event: string
          _fingerprint: string
          _path?: string
          _product?: string
          _slug: string
          _source?: string
        }
        Returns: boolean
      }
      update_order_shipping: {
        Args: {
          _courier: string
          _order_id: string
          _tracking_number: string
          _tracking_url: string
        }
        Returns: undefined
      }
      usage_summary: { Args: { _uid: string }; Returns: Json }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
