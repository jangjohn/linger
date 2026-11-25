import { useParams } from "react-router";

import { requireRoomRouteParam } from "@/features/rooms/room-route-params";
import { useTeamHubRuntime } from "@/features/teamhub/teamhub-runtime";
import { useT } from "@/i18n/use-translation";

import { AccountProfileSettings } from "./account-profile-settings";
import { accountSettingsMessages } from "./account-settings.messages";
import { SettingsPageHeading } from "./settings-page-heading";
import { settingsMessages } from "./settings.messages";

export function AccountSettingsPage() {
  const t = useT();
  const { client } = useTeamHubRuntime();
  const tenantId = requireRoomRouteParam(useParams().tenantId, "Tenant");

  return (
    <div className="mx-auto flex w-full max-w-(--app-settings-width) flex-col gap-8 pb-4">
      <SettingsPageHeading
        description={t(accountSettingsMessages.profileDescription)}
        title={t(settingsMessages.profile)}
      />

      <AccountProfileSettings client={client} tenantId={tenantId} />
    </div>
  );
}
