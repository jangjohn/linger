import { startsMentionToken } from "@/features/teamhub/mention-boundary";
import type { TeamHubActorRef } from "@/features/teamhub/teamhub-types";
import {
  findTeamHubMessageTokenMatches,
  formatTeamHubMentionToken,
  teamHubMentionTokenAliases,
} from "@/features/teamhub/teamhub-message-content";

export interface MessageMentionQuery {
  end: number;
  query: string;
  start: number;
}

export function formatMentionToken(actor: TeamHubActorRef) {
  return formatTeamHubMentionToken(actor);
}

export function findMessageMentionQuery(
  body: string,
  cursor: number,
): MessageMentionQuery | null {
  const boundedCursor = Math.max(0, Math.min(cursor, body.length));
  const beforeCursor = body.slice(0, boundedCursor);
  // Chinese, Japanese and Korean prose has no spaces, so `@` after a Han
  // character still starts a mention; a word in a script that does use spaces,
  // a number, or a path or address character before it keeps the `@` literal.
  const match = beforeCursor.match(/@([\p{L}\p{N}_-]*)$/u);

  if (!match || !startsMentionToken(beforeCursor, match.index!)) {
    return null;
  }

  const query = match[1] ?? "";
  return { end: boundedCursor, query, start: match.index! };
}

export function findMessageMentionCandidates(
  query: MessageMentionQuery | null,
  options: TeamHubActorRef[],
) {
  if (!query) {
    return [];
  }

  const normalizedQuery = query.query.toLocaleLowerCase();
  const matcher = new RegExp(escapeRegExp(normalizedQuery), "u");
  return options.filter((actor) => matcher.test(mentionSearchText(actor)));
}

export function replaceMessageMention(
  body: string,
  query: MessageMentionQuery,
  actor: TeamHubActorRef,
) {
  const suffix = body.slice(query.end);
  const separator = !suffix || !/^[\s.,!?;:()[\]{}]/.test(suffix) ? " " : "";
  const replacement = `${formatMentionToken(actor)}${separator}`;
  return {
    body: `${body.slice(0, query.start)}${replacement}${suffix}`,
    cursor: query.start + replacement.length,
  };
}

export function activeMessageMentions(
  body: string,
  mentions: TeamHubActorRef[],
) {
  const actorsByToken = new Map(
    mentions.flatMap((actor) =>
      teamHubMentionTokenAliases(actor).map((token) => [token, actor] as const),
    ),
  );
  const orderedActors: TeamHubActorRef[] = [];
  const seen = new Set<string>();

  for (const match of findTeamHubMessageTokenMatches(
    body,
    actorsByToken.keys(),
  )) {
    const actor = actorsByToken.get(match.token);
    if (!actor || seen.has(actor.id)) {
      continue;
    }
    orderedActors.push(actor);
    seen.add(actor.id);
  }

  return orderedActors;
}

function mentionSearchText(actor: TeamHubActorRef) {
  return formatMentionToken(actor).slice(1).toLocaleLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
