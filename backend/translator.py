"""Translation helpers backed by the gestures collection."""

from mongodb_client import get_gestures_collection


class Translator:
    """Handles translation of gestures to different languages."""

    VALID_LANGUAGES = {'english', 'luganda'}

    def translate(self, gesture_name, target_language='english'):
        """Translate a gesture name using the database when available."""
        translations = self.translate_all(gesture_name)
        if not translations:
            return None

        language = (target_language or 'english').strip().lower()
        if language not in self.VALID_LANGUAGES:
            return None

        return translations.get(language)

    def translate_all(self, gesture_name):
        """Return both English and Luganda translations for a gesture."""
        if not gesture_name:
            return None

        try:
            gestures = get_gestures_collection()
            row = gestures.find_one({'gesture_name': gesture_name})
            if row:
                return {
                    'english': row.get('english_meaning') or self._format_gesture(gesture_name),
                    'luganda': row.get('luganda_meaning') or self._format_gesture(gesture_name),
                }
        except Exception as exc:
            print(f"Error in translation lookup: {exc}")

        translation_dict = self._get_translation_dict()
        gesture = translation_dict.get(gesture_name)
        if not gesture:
            formatted = self._format_gesture(gesture_name)
            return {'english': formatted, 'luganda': formatted}
        return gesture

    def _get_translation_dict(self):
        """Fallback translation dictionary."""
        return {
            'hello': {'english': 'Hello', 'luganda': 'Oli otya'},
            'thank_you': {'english': 'Thank you', 'luganda': 'Weebale'},
            'yes': {'english': 'Yes', 'luganda': 'Yee'},
            'no': {'english': 'No', 'luganda': 'Nedda'},
            'good': {'english': 'Good', 'luganda': 'Kirungi'},
            'bad': {'english': 'Bad', 'luganda': 'Bibi'},
            'how': {'english': 'How are you?', 'luganda': 'Oli otya?'},
            'fine': {'english': 'I am fine', 'luganda': 'Gyendi'},
            'you': {'english': 'You', 'luganda': 'Ggwe'},
        }

    def _format_gesture(self, gesture_name):
        return str(gesture_name or '').replace('_', ' ').title()

    def translate_text(self, text, source_lang='english', target_lang='luganda'):
        """Translate text between languages using the fallback dictionary."""
        translations = self._get_translation_dict()

        for langs in translations.values():
            if text.lower() == langs.get(source_lang, '').lower():
                return langs.get(target_lang, text)

        return text
