"""Tests du plugin, avec des doublures des modules fournis par EDMC."""

import importlib.util
import pathlib
import sys
import types
import unittest
from unittest import mock

TOKEN = 'a' * 43


def install_stubs():
    config = types.ModuleType('config')
    config.appname = 'EDMarketConnector'
    config.config = mock.Mock()
    config.config.get_str.return_value = TOKEN
    monitor = types.ModuleType('monitor')
    monitor.monitor = mock.Mock()
    monitor.monitor.is_live_galaxy.return_value = True
    session = types.ModuleType('timeout_session')
    session.new_session = mock.Mock()
    requests = types.ModuleType('requests')
    requests.RequestException = type('RequestException', (Exception,), {})
    notebook = types.ModuleType('myNotebook')
    # Uniquement les noms qui existent vraiment dans myNotebook (EDMC 6.1)
    notebook.Notebook = notebook.Frame = notebook.Label = notebook.EntryMenu = mock.Mock()
    sys.modules.update({
        'config': config, 'monitor': monitor, 'timeout_session': session,
        'requests': requests, 'myNotebook': notebook, 'tkinter': mock.Mock(),
    })


def load_plugin():
    install_stubs()
    path = pathlib.Path(__file__).parents[1] / 'Squadron_Tracker' / 'load.py'
    spec = importlib.util.spec_from_file_location('load_under_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Base(unittest.TestCase):
    def setUp(self):
        self.load = load_plugin()
        self.load.thread = mock.Mock()
        self.entry = {
            'timestamp': '2026-11-01T10:57:02Z', 'event': 'PowerplayMerits', 'Power': 'Aisling Duval',
            'MeritsGained': 759, 'TotalMerits': 1095073,
        }


class Payload(Base):
    def test_seuls_quatre_champs_sortent(self):
        entry = {**self.entry, 'Secret': 'ne doit pas sortir'}
        self.assertEqual(self.load.build_payload('CMDR Test', 'Sol', entry), {
            'cmdr': 'CMDR Test', 'system': 'Sol', 'merits': 759, 'at': '2026-11-01T10:57:02Z',
        })

    def test_valeurs_invalides_refusees(self):
        for merits in (0, -5, '12', 1.5, True, None):
            self.assertIsNone(self.load.build_payload('C', 'X', {**self.entry, 'MeritsGained': merits}))
        self.assertIsNone(self.load.build_payload('', 'X', self.entry))


class Journal(Base):
    def queued(self):
        return self.load.outbox.qsize()

    def test_un_evenement_de_merites_est_mis_en_file(self):
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.assertEqual(self.queued(), 1)

    def test_les_autres_evenements_sont_ignores(self):
        self.load.journal_entry('C', False, 'X', '', {'event': 'FSDJump', 'MeritsGained': 5}, {})
        self.assertEqual(self.queued(), 0)

    def test_beta_et_legacy_ignores(self):
        self.load.journal_entry('C', True, 'X', '', self.entry, {})
        self.load.monitor.is_live_galaxy.return_value = False
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.assertEqual(self.queued(), 0)

    def test_sans_jeton_valide_rien_ne_part(self):
        self.load.config.get_str.return_value = 'trop-court'
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.assertEqual(self.queued(), 0)

    def test_sans_serveur_le_plugin_reste_inactif(self):
        self.load.SERVER_URL = ''
        self.load.plugin_start3('dossier')
        self.assertIsNone(self.load.thread)
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.assertEqual(self.queued(), 0)


class Prefs(Base):
    def test_la_page_de_reglages_se_construit(self):
        self.assertIsNotNone(self.load.plugin_prefs(mock.Mock(), 'C', False))


class Deliver(Base):
    def post(self, status=None, error=None):
        session = mock.Mock()
        session.post.return_value = mock.Mock(status_code=status)
        session.post.side_effect = error
        return session, self.load.deliver(session, 'https://x/v1/merits', TOKEN, {'merits': 1})

    def test_reussite_refus_et_nouvel_essai(self):
        self.assertEqual(self.post(200)[1], 'ok')
        for status in (400, 401, 403, 413):
            self.assertEqual(self.post(status)[1], 'drop')
        for status in (302, 429, 500, 503):
            self.assertEqual(self.post(status)[1], 'retry')

    def test_coupure_reseau(self):
        self.assertEqual(self.post(error=self.load.requests.RequestException())[1], 'retry')

    def test_le_jeton_ne_suit_jamais_une_redirection(self):
        session, _ = self.post(200)
        self.assertIs(session.post.call_args.kwargs['allow_redirects'], False)
        self.assertEqual(session.post.call_args.kwargs['headers']['Authorization'], f'Bearer {TOKEN}')


if __name__ == '__main__':
    unittest.main()
