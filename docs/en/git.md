[Français](../fr/git.md) · [English](git.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="gérer-git-dans-galeata"></a>

# Manage Git in Galeata

Click on the name branch **bottom left** to open « Branches et stash », from any page. The Git page offers the same access above the overview and the comparator.

<a id="branches-et-fusion"></a>

## Branches and merging

- The list separates the branches local and remote. The filter allows to find a branch by his name.
- **`Activer`** changes the branch common. For a branch distant, Galeata reuse its branch local monitoring or create it. One branch used in another worktree Can't be activated here.
- **`Créer et activer`** creates a branch from the current position and switch over.
- **`Fusionner`** integrates branch selected in the branch active. The confirmation explicitly displays the source and destination. To change destination, first activate this branch.

Git retains its protection against crushing of local modifications. Galeata asks to save or close the modified tabs before an operation that changes the files. Open files are read after operation; a change entered during the operation is kept and reported as external.

In case of conflict, open the relevant files, correct them and index them. « Terminer la fusion » is available once conflicts are indexed. « Annuler la fusion » returns to the previous state; confirmation prevents the termination of the corrections to this merger. Conflicts arising from stash are not presented as a cancelable merger.

<a id="mettre-des-modifications-de-côté"></a>

## Set changes aside

Tab **`Stash`** proposes an optional message. « Créer le stash » sets aside the tracked changes and untracked files, without including files ignored by Git.

After having activated the branch choose:

- **`Appliquer et conserver`** : restores the files and keeps the stash.
- **`Restaurer et retirer (pop)`** : restores files and then removes the stash if the operation succeeds. Git keeps the stash in case of conflict.

Restoration also restores indexed changes. Content identifier is reverified at the time of action to avoid restoring another stash if the list has changed in a terminal.

<a id="synchroniser"></a>

## Synchronize

- **`Récupérer (fetch)`** updates the references of all repositories Remote, without changing working files.
- **`Mettre à jour (pull)`** forward the branch from its remote tracking, only if a fast-forward is possible. A divergence remains to be addressed explicitly.
- **`Publier (push)`** send commits. For the first push, choose the repository remote in « Branches et stash » : the remote tracking is then configured.

Manager displays remote tracking and numbers of commits to publish and recover. These numbers reflect locally known references; fetch update them.

The browser preview simulates these actions on its memory examples. He never accesses repository Local. Actual commands require desktop application.
