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
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      elo_history: {
        Row: {
          created_at: string
          date: string
          game_id: string | null
          games_played: number | null
          id: string
          is_general: boolean
          play_id: string
          player_id: string
          player_name: string
          rating: number
          rating_change: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          date: string
          game_id?: string | null
          games_played?: number | null
          id?: string
          is_general?: boolean
          play_id: string
          player_id: string
          player_name: string
          rating: number
          rating_change: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          date?: string
          game_id?: string | null
          games_played?: number | null
          id?: string
          is_general?: boolean
          play_id?: string
          player_id?: string
          player_name?: string
          rating?: number
          rating_change?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "elo_history_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elo_history_play_id_fkey"
            columns: ["play_id"]
            isOneToOne: false
            referencedRelation: "plays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "elo_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      elo_recalc_runs: {
        Row: {
          finished_at: string | null
          id: string
          started_at: string
          status: string
          summary: Json | null
        }
        Insert: {
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          summary?: Json | null
        }
        Update: {
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          summary?: Json | null
        }
        Relationships: []
      }
      games: {
        Row: {
          bga_id: string | null
          created_at: string | null
          id: string
          image_url: string | null
          max_players: number | null
          min_players: number | null
          name: string
        }
        Insert: {
          bga_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          max_players?: number | null
          min_players?: number | null
          name: string
        }
        Update: {
          bga_id?: string | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          max_players?: number | null
          min_players?: number | null
          name?: string
        }
        Relationships: []
      }
      play_scores: {
        Row: {
          color: string | null
          id: string
          play_id: string | null
          player_id: string | null
          position: number | null
          role: string | null
          score: number | null
          winner: boolean | null
        }
        Insert: {
          color?: string | null
          id?: string
          play_id?: string | null
          player_id?: string | null
          position?: number | null
          role?: string | null
          score?: number | null
          winner?: boolean | null
        }
        Update: {
          color?: string | null
          id?: string
          play_id?: string | null
          player_id?: string | null
          position?: number | null
          role?: string | null
          score?: number | null
          winner?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "play_scores_play_id_fkey"
            columns: ["play_id"]
            isOneToOne: false
            referencedRelation: "plays"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_scores_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_general_ratings: {
        Row: {
          created_at: string | null
          draws: number | null
          games_played: number | null
          id: string
          last_played_at: string | null
          losses: number | null
          player_id: string | null
          rating: number | null
          updated_at: string | null
          user_id: string | null
          wins: number | null
        }
        Insert: {
          created_at?: string | null
          draws?: number | null
          games_played?: number | null
          id?: string
          last_played_at?: string | null
          losses?: number | null
          player_id?: string | null
          rating?: number | null
          updated_at?: string | null
          user_id?: string | null
          wins?: number | null
        }
        Update: {
          created_at?: string | null
          draws?: number | null
          games_played?: number | null
          id?: string
          last_played_at?: string | null
          losses?: number | null
          player_id?: string | null
          rating?: number | null
          updated_at?: string | null
          user_id?: string | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_general_ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_ratings: {
        Row: {
          created_at: string | null
          draws: number | null
          game_id: string | null
          games_played: number | null
          id: string
          last_played_at: string | null
          losses: number | null
          player_id: string | null
          rating: number | null
          updated_at: string | null
          wins: number | null
        }
        Insert: {
          created_at?: string | null
          draws?: number | null
          game_id?: string | null
          games_played?: number | null
          id?: string
          last_played_at?: string | null
          losses?: number | null
          player_id?: string | null
          rating?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Update: {
          created_at?: string | null
          draws?: number | null
          game_id?: string | null
          games_played?: number | null
          id?: string
          last_played_at?: string | null
          losses?: number | null
          player_id?: string | null
          rating?: number | null
          updated_at?: string | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_ratings_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          alias: string | null
          avatar_url: string | null
          color: string | null
          created_at: string | null
          id: string
          is_me: boolean | null
          name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          alias?: string | null
          avatar_url?: string | null
          color?: string | null
          created_at?: string | null
          id?: string
          is_me?: boolean | null
          name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          alias?: string | null
          avatar_url?: string | null
          color?: string | null
          created_at?: string | null
          id?: string
          is_me?: boolean | null
          name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      plays: {
        Row: {
          bga_table_id: string | null
          created_at: string | null
          duration_minutes: number | null
          game_id: string | null
          id: string
          is_cooperative: boolean | null
          location: string | null
          notes: string | null
          played_at: string
          source: string | null
          team_won: boolean | null
          user_id: string | null
        }
        Insert: {
          bga_table_id?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          game_id?: string | null
          id?: string
          is_cooperative?: boolean | null
          location?: string | null
          notes?: string | null
          played_at: string
          source?: string | null
          team_won?: boolean | null
          user_id?: string | null
        }
        Update: {
          bga_table_id?: string | null
          created_at?: string | null
          duration_minutes?: number | null
          game_id?: string | null
          id?: string
          is_cooperative?: boolean | null
          location?: string | null
          notes?: string | null
          played_at?: string
          source?: string | null
          team_won?: boolean | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plays_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_play_user_ids: {
        Args: never
        Returns: {
          user_id: string
        }[]
      }
      replace_play_scores: {
        Args: { p_play_id: string; p_scores: Json }
        Returns: {
          color: string | null
          id: string
          play_id: string | null
          player_id: string | null
          position: number | null
          role: string | null
          score: number | null
          winner: boolean | null
        }[]
        SetofOptions: {
          from: "*"
          to: "play_scores"
          isOneToOne: false
          isSetofReturn: true
        }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
