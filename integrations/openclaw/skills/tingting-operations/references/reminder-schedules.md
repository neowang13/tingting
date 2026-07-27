# Monthly reminder schedules

Ting Ting v1 supports one monthly schedule per tenant. Email and SMS share the
same reminder day, local time, and timezone. Do not collapse a request for
different channel times; explain that it needs a future version.

Ordinary saves must use `isEnabled=false`. Display the next candidate occurrence
in local and UTC time, channel eligibility, template names, provider mode,
global pause, and force pause.

Enable/disable requires a version-bound confirmation from a new owner message.
The existing five-minute website worker owns every delivery. This Skill cannot
send directly or alter provider mode, pause environment variables, or Cron.

