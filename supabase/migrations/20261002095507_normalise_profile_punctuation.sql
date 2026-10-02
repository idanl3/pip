-- Replace typographic punctuation in saved profiles with plain ASCII.
--
-- The onboarding suggestions used em dashes and curly apostrophes. Those store
-- correctly - the database holds a proper U+2014 - but somewhere between here
-- and ElevenLabs the UTF-8 is decoded as Latin-1, and the agent received three
-- characters of mojibake instead. Pip was reading
--
--   "Sensitive a- feels things deeply"
--
-- inside a child's profile, and "a parenta-s attention" among the recurring
-- conflicts. The owner's own prompt was plain ASCII throughout and never had
-- the problem.
--
-- The suggestion lists are now ASCII, which fixes it going forward. This fixes
-- what is already saved, and it is not merely cosmetic: a stored value has to
-- match a suggestion exactly for its chip to come back ticked when a parent
-- reopens the form. Leave these as they are and every em-dashed answer the
-- owner has already given would reappear as free text.
--
-- Safe to run against live profiles: the guard triggers treat a null auth.uid()
-- as a trusted server context, so this does not knock any family back to
-- pending review.

create or replace function public.ascii_punctuation(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
           replace(value, U&'\2014', '-'),   -- em dash
           U&'\2019' || U&'\2018' || U&'\201C' || U&'\201D',
           '''' || '''' || '"' || '"'
         );
$$;

comment on function public.ascii_punctuation(text) is
  'Plain-ASCII equivalent of typographic dashes and quotes, so profile text '
  'survives the trip to the voice agent intact.';

update public.children
   set personality       = public.ascii_punctuation(personality),
       conflict_tendency = public.ascii_punctuation(conflict_tendency)
 where personality       <> public.ascii_punctuation(personality)
    or conflict_tendency <> public.ascii_punctuation(conflict_tendency);

update public.families
   set recurring_conflicts = public.ascii_punctuation(recurring_conflicts),
       house_rules         = public.ascii_punctuation(house_rules),
       extra_care          = public.ascii_punctuation(extra_care)
 where recurring_conflicts <> public.ascii_punctuation(recurring_conflicts)
    or house_rules         <> public.ascii_punctuation(house_rules)
    or extra_care          <> public.ascii_punctuation(extra_care);
