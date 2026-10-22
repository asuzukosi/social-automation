from social_automation.core.models import AccessMode, ActionName, Capability


def capability(operation: str, write: bool, supported: bool) -> Capability:
    restrictions = [
        "Browser automation may trigger restrictions",
        "No bulk automation" if write else "Reads are bounded",
    ]
    detail = {
        "get_profile": "Company reads require a canonical /company/ URL",
        "get_feed": "The visible feed does not expose a stable resume cursor",
        "get_conversation": "Opening a conversation may mark it as read",
    }.get(operation)
    if detail:
        restrictions.append(detail)
    return Capability(
        operation=operation,
        supported=supported,
        write=write,
        authentication="Dedicated LinkedIn browser profile",
        access=AccessMode.BROWSER,
        automation_allowed=supported and not write,
        approval_required=supported and write,
        reliably_confirmed=supported
        and (not write or operation in {ActionName.REACT.value, ActionName.SEND_MESSAGE.value}),
        max_items_per_call=_read_limit(operation) if supported and not write else None,
        max_writes_per_confirmation=1 if supported and write else None,
        restrictions=restrictions,
    )


def _read_limit(operation: str) -> int:
    return {"get_thread": 200, "get_inbox": 50, "search": 25, "get_feed": 25}.get(
        operation, 1
    )
