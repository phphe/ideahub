import { translate, type Translator } from './i18n';

export function describeReleaseImmutability(
  immutable: boolean | undefined,
  t: Translator = translate
): string {
  if (immutable === true) {
    return t('This proof is confirmed immutable.');
  }
  if (immutable === false) {
    return t(
      'This release is mutable; the repository may not have this setting enabled.'
    );
  }
  return t(
    'The immutability of this release is unknown (the API did not return the immutable field).'
  );
}
