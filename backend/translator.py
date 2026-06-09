"""Translation helpers backed by the gestures table."""

try:
    from .database import get_db
except ImportError:
    from database import get_db


class Translator:
    """Handles translation of gestures to different languages."""

    VALID_LANGUAGES = {'english', 'luganda'}

    def translate(self, gesture_name, target_language='english'):
        """Translate a gesture name using the database when available."""
        if not gesture_name:
            return None

        language = (target_language or 'english').strip().lower()
        if language not in self.VALID_LANGUAGES:
            return None

        try:
            db = get_db()
            cursor = db.cursor()
            cursor.execute(
                '''SELECT english_meaning, luganda_meaning
                   FROM gestures
                   WHERE gesture_name = ?''',
                (gesture_name,)
            )
            row = cursor.fetchone()
            if row:
                return row['english_meaning'] if language == 'english' else row['luganda_meaning']
        except Exception as exc:
            print(f"Error in translation lookup: {exc}")

        translation_dict = self._get_translation_dict()
        gesture = translation_dict.get(gesture_name)
        if not gesture:
            return None
        return gesture.get(language)

    def _get_translation_dict(self):
        """Fallback translation dictionary."""
        return {
            'hello': {'english': 'Hello', 'luganda': 'Wabale'},
            'thank_you': {'english': 'Thank you', 'luganda': 'Asante'},
            'yes': {'english': 'Yes', 'luganda': 'Yee'},
            'no': {'english': 'No', 'luganda': 'Nedda'},
            'good': {'english': 'Good', 'luganda': 'Nyo'},
            'bad': {'english': 'Bad', 'luganda': 'Bibi'},
        }

    def translate_text(self, text, source_lang='english', target_lang='luganda'):
        """Translate text between languages using the fallback dictionary."""
        translations = self._get_translation_dict()

        for langs in translations.values():
            if text.lower() == langs.get(source_lang, '').lower():
                return langs.get(target_lang, text)

        return text
