import { SetupRequired } from '@/components/setup-required'

/**
 * Reached only when Supabase credentials are absent — the proxy redirects here
 * before any page that queries the database can run.
 */
export default function SetupPage() {
  return <SetupRequired />
}
