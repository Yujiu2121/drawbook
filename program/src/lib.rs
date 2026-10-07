//! Drawbook's commit-reveal raffle on Rialo.
//!
//! A plain rialo-s-* program rather than rialo-sol-lang or Venus, because the deploy holds rent on
//! every byte of the blob and the whole deploy has to fit inside a 1 RLO faucet grant. The
//! interface (account layout, hashes, instruction data, error codes) is program/SPEC.md, and the
//! draw is lib/raffle.ts reproduced exactly, so the browser can audit any draw this program makes.
//!
//! Every refusal is a ProgramError::Custom code from the spec's table, so the page can tell a
//! person in plain words why the chain said no. Panics are reserved for states the checks make
//! unreachable, and they abort the transaction rather than writing anything.

extern crate alloc;

mod draw;
mod layout;

use alloc::vec::Vec;
use core::cell::RefMut;
use layout::*;
use rialo_s_account_info::AccountInfo;
use rialo_s_instruction::{AccountMeta, Instruction};
use rialo_s_program_entrypoint::ProgramResult;
use rialo_s_program_error::ProgramError;
use rialo_s_pubkey::Pubkey;
use rialo_s_sysvar::{clock::Clock, Sysvar};

#[cfg(not(feature = "no-entrypoint"))]
rialo_s_program_entrypoint::entrypoint!(process_instruction);

/// A panic here means a check above it is wrong, and the transaction aborts either way, so the
/// handler does nothing rather than format the PanicInfo into the log. That alone keeps roughly
/// 25 KB of core::fmt out of the blob.
#[cfg(all(feature = "custom-panic", target_os = "solana"))]
#[no_mangle]
fn custom_panic(_info: &core::panic::PanicInfo<'_>) {}

// Error codes, as SPEC.md numbers them.
const BAD_INSTRUCTION: u32 = 1;
const BAD_ACCOUNT: u32 = 2;
const ALREADY_INITIALISED: u32 = 3;
const NOT_INITIALISED: u32 = 4;
const BAD_CONFIG: u32 = 5;
const SALE_CLOSED: u32 = 6;
const WRONG_TICKET: u32 = 7;
const REVEALS_NOT_OPEN: u32 = 8;
const REVEALS_CLOSED: u32 = 9;
const NOT_HOLDER: u32 = 10;
const ALREADY_REVEALED: u32 = 11;
const COMMITMENT_MISMATCH: u32 = 12;
const NOT_READY: u32 = 13;
const ALREADY_SETTLED: u32 = 14;
const NOTHING_TO_CLAIM: u32 = 15;
const ARITHMETIC: u32 = 16;
const DRAW_MUST_RUN_ALONE: u32 = 17;
const TOO_SOON: u32 = 18;

/// The line logged on a refusal, indexed by code, so a transaction's logs say which rule fired
/// without the page having to decode the hex code the runtime prints. Whole lines rather than a
/// name pasted onto a prefix, because joining strings would need formatting or an allocation.
const REFUSALS: [&str; 19] = [
    "",
    "Drawbook refused: BadInstruction",
    "Drawbook refused: BadAccount",
    "Drawbook refused: AlreadyInitialised",
    "Drawbook refused: NotInitialised",
    "Drawbook refused: BadConfig",
    "Drawbook refused: SaleClosed",
    "Drawbook refused: WrongTicket",
    "Drawbook refused: RevealsNotOpen",
    "Drawbook refused: RevealsClosed",
    "Drawbook refused: NotHolder",
    "Drawbook refused: AlreadyRevealed",
    "Drawbook refused: CommitmentMismatch",
    "Drawbook refused: NotReady",
    "Drawbook refused: AlreadySettled",
    "Drawbook refused: NothingToClaim",
    "Drawbook refused: Arithmetic",
    "Drawbook refused: DrawMustRunAlone",
    "Drawbook refused: TooSoon",
];

/// The system program, 32 zero bytes (base58 "11111111111111111111111111111111").
const SYSTEM_PROGRAM: Pubkey = Pubkey::new_from_array([0u8; 32]);

fn fail(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}

/// Every add, multiply and subtract on an amount goes through here, so an overflow or a balance
/// that would go below zero is a stated refusal (16) and never a wrap.
fn arith(v: Option<u64>) -> Result<u64, ProgramError> {
    v.ok_or(fail(ARITHMETIC))
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    data: &[u8],
) -> ProgramResult {
    let result = match data.first() {
        Some(0) => create(program_id, accounts, data),
        Some(1) => buy(program_id, accounts, data),
        Some(2) => reveal(program_id, accounts, data),
        Some(3) => draw_raffle(program_id, accounts, data),
        Some(4) => claim(program_id, accounts, data),
        _ => Err(fail(BAD_INSTRUCTION)),
    };
    if let Err(ProgramError::Custom(code)) = result {
        if let Some(line) = REFUSALS.get(code as usize) {
            rialo_s_msg::rlo_log(line);
        }
    }
    result
}

/* ------------------------------------------------------------- shared checks */

/// The chain clock. Rialo's `unix_timestamp` is in milliseconds, which is the unit every
/// deadline in the account is stored in.
fn now_ms() -> Result<u64, ProgramError> {
    let ts = Clock::get()?.unix_timestamp;
    u64::try_from(ts).map_err(|_| fail(ARITHMETIC))
}

/// Low 32 bits of the current slot, the form H_LAST_REVEAL_SLOT stores. Truncating is safe
/// because the slot is only ever compared for equality with a slot from the same raffle's life.
fn slot_low32() -> Result<u32, ProgramError> {
    Ok(Clock::get()?.slot as u32)
}

/// 1 at transaction level, 2 and up inside a CPI. Measured on this runtime on 2026-10-07.
fn stack_height() -> u64 {
    #[cfg(target_os = "solana")]
    unsafe {
        rialo_s_instruction::syscalls::rlo_get_stack_height()
    }
    #[cfg(not(target_os = "solana"))]
    {
        rialo_s_instruction::TRANSACTION_LEVEL_STACK_HEIGHT as u64
    }
}

/// True when the running instruction is called directly by the transaction (not through another
/// program) and is the only instruction in it. Draw insists on this so that nothing that runs in
/// the same transaction can read the outcome and make the whole transaction fail when it dislikes
/// it, which would let a caller retry block after block until the draw suits them.
fn runs_alone(sysvar: &AccountInfo<'_>) -> Result<bool, ProgramError> {
    if !rialo_s_instructions_sysvar::check_id(sysvar.key) {
        return Ok(false);
    }
    if stack_height() != rialo_s_instruction::TRANSACTION_LEVEL_STACK_HEIGHT as u64 {
        return Ok(false);
    }
    let count = {
        let d = sysvar.try_borrow_data()?;
        if d.len() < 2 {
            return Ok(false);
        }
        u16::from_le_bytes([d[0], d[1]])
    };
    let current = rialo_s_instructions_sysvar::load_current_index_checked(sysvar)?;
    Ok(count == 1 && current == 0)
}

fn account<'a, 'b>(accounts: &'a [AccountInfo<'b>], i: usize) -> Result<&'a AccountInfo<'b>, ProgramError> {
    accounts.get(i).ok_or(fail(BAD_ACCOUNT))
}

fn require(ok: bool, code: u32) -> ProgramResult {
    if ok {
        Ok(())
    } else {
        Err(fail(code))
    }
}

/// Borrow an initialised raffle's data after checking everything that makes it ours: owned by
/// this program, writable, carrying the magic and version, and exactly as long as its own supply
/// says. Every instruction after Create starts here.
fn open_raffle<'a, 'b>(
    program_id: &Pubkey,
    raffle: &'a AccountInfo<'b>,
) -> Result<RefMut<'a, &'b mut [u8]>, ProgramError> {
    require(raffle.owner == program_id && raffle.is_writable, BAD_ACCOUNT)?;
    let d = raffle.try_borrow_mut_data()?;
    require(d.len() >= HEADER_LEN, BAD_ACCOUNT)?;
    require(&d[H_MAGIC..H_MAGIC + 8] == MAGIC && d[H_VERSION] == VERSION, NOT_INITIALISED)?;
    require(d.len() == account_len(get_u16(&d, H_SUPPLY)), BAD_ACCOUNT)?;
    Ok(d)
}

/// The sale closes at the commit deadline, or earlier the moment the last ticket sells.
fn sale_closed(d: &[u8], now: u64) -> bool {
    now >= get_u64(d, H_COMMIT_DEADLINE) || get_u16(d, H_SOLD) == get_u16(d, H_SUPPLY)
}

/// A system-program Transfer, encoded by hand (u32 LE tag 2, u64 LE kelvins) so the program does
/// not need the bincode-backed system-interface crate for one fixed 12-byte layout.
fn system_transfer<'b>(
    from: &AccountInfo<'b>,
    to: &AccountInfo<'b>,
    system: &AccountInfo<'b>,
    kelvins: u64,
) -> ProgramResult {
    let mut data = Vec::with_capacity(12);
    data.extend_from_slice(&2u32.to_le_bytes());
    data.extend_from_slice(&kelvins.to_le_bytes());
    let ix = Instruction {
        program_id: SYSTEM_PROGRAM,
        accounts: alloc::vec![AccountMeta::new(*from.key, true), AccountMeta::new(*to.key, false)],
        data,
    };
    rialo_s_cpi::invoke(&ix, &[from.clone(), to.clone(), system.clone()])
}

/// Move kelvins out of the program-owned raffle account directly. Only the owning program may
/// debit an account, so no CPI is needed; the checked subtraction is what stops the raffle ever
/// paying out kelvins it does not hold.
fn pay_out(raffle: &AccountInfo<'_>, to: &AccountInfo<'_>, amount: u64) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    let from_after = arith(raffle.kelvins().checked_sub(amount))?;
    let to_after = arith(to.kelvins().checked_add(amount))?;
    **raffle.try_borrow_mut_kelvins()? = from_after;
    **to.try_borrow_mut_kelvins()? = to_after;
    Ok(())
}

/* ------------------------------------------------------------- 0 Create */

fn create(program_id: &Pubkey, accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    require(data.len() == 77, BAD_INSTRUCTION)?;
    let creator = account(accounts, 0)?;
    let raffle = account(accounts, 1)?;
    let system = account(accounts, 2)?;
    require(creator.is_signer && creator.is_writable, BAD_ACCOUNT)?;
    require(raffle.owner == program_id && raffle.is_writable, BAD_ACCOUNT)?;
    require(creator.key != raffle.key && *system.key == SYSTEM_PROGRAM, BAD_ACCOUNT)?;

    let prize = get_u64(data, 1);
    let ticket_price = get_u64(data, 9);
    let reveal_bond = get_u64(data, 17);
    let supply = get_u16(data, 25);
    let winners = get_u16(data, 27);
    let commit_deadline = get_u64(data, 29);
    let reveal_deadline = get_u64(data, 37);
    let title = &data[45..45 + TITLE_LEN];

    {
        let d = raffle.try_borrow_data()?;
        // Magic first: a used account is reported as used even when the supply sent with this
        // Create would also give a length mismatch, because "already initialised" is the
        // explanation a person can act on.
        require(d.len() < 8 || d[H_MAGIC..H_MAGIC + 8] == [0u8; 8], ALREADY_INITIALISED)?;
        require(d.len() == account_len(supply), BAD_ACCOUNT)?;
    }

    let now = now_ms()?;
    let in_range = (MIN_SUPPLY..=MAX_SUPPLY).contains(&supply)
        && winners >= 1
        && winners <= supply
        && ticket_price >= 1
        && now < commit_deadline
        && commit_deadline - now <= MAX_SALE_MS
        && commit_deadline < reveal_deadline
        && reveal_deadline - commit_deadline >= MIN_REVEAL_MS
        && reveal_deadline - commit_deadline <= MAX_REVEAL_MS;
    // A raffle whose full sale would overflow u64 is refused here, so the pool sum at the draw
    // can never fail on arithmetic and leave a sold-out raffle stuck.
    let fits = ticket_price
        .checked_add(reveal_bond)
        .and_then(|t| t.checked_mul(supply as u64))
        .and_then(|t| t.checked_add(prize))
        .is_some();
    require(in_range && fits, BAD_CONFIG)?;

    if prize > 0 {
        system_transfer(creator, raffle, system, prize)?;
    }

    let mut d = raffle.try_borrow_mut_data()?;
    d[H_MAGIC..H_MAGIC + 8].copy_from_slice(MAGIC);
    d[H_VERSION] = VERSION;
    d[H_STATUS] = STATUS_OPEN;
    put_u16(&mut d, H_SUPPLY, supply);
    put_u16(&mut d, H_WINNERS, winners);
    d[H_CREATOR..H_CREATOR + 32].copy_from_slice(creator.key.as_ref());
    put_u64(&mut d, H_PRIZE, prize);
    put_u64(&mut d, H_TICKET_PRICE, ticket_price);
    put_u64(&mut d, H_REVEAL_BOND, reveal_bond);
    put_u64(&mut d, H_COMMIT_DEADLINE, commit_deadline);
    put_u64(&mut d, H_REVEAL_DEADLINE, reveal_deadline);
    put_u64(&mut d, H_CREATED_AT, now);
    d[H_TITLE..H_TITLE + TITLE_LEN].copy_from_slice(title);
    rialo_s_msg::msg!("Drawbook: raffle created");
    Ok(())
}

/* ------------------------------------------------------------- 1 Buy */

fn buy(program_id: &Pubkey, accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    require(data.len() == 35, BAD_INSTRUCTION)?;
    let buyer = account(accounts, 0)?;
    let raffle = account(accounts, 1)?;
    let system = account(accounts, 2)?;
    require(buyer.is_signer && buyer.is_writable, BAD_ACCOUNT)?;
    require(buyer.key != raffle.key && *system.key == SYSTEM_PROGRAM, BAD_ACCOUNT)?;
    let ticket_index = get_u16(data, 1);

    let cost = {
        let d = open_raffle(program_id, raffle)?;
        let now = now_ms()?;
        let sold = get_u16(&d, H_SOLD);
        require(d[H_STATUS] == STATUS_OPEN, SALE_CLOSED)?;
        require(now < get_u64(&d, H_COMMIT_DEADLINE), SALE_CLOSED)?;
        require(sold < get_u16(&d, H_SUPPLY), SALE_CLOSED)?;
        // Binding the index the buyer hashed into the commitment: a commitment made for the
        // wrong index could never be revealed, so it is refused now instead of stranding a bond.
        require(ticket_index as u32 == sold as u32 + 1, WRONG_TICKET)?;
        arith(get_u64(&d, H_TICKET_PRICE).checked_add(get_u64(&d, H_REVEAL_BOND)))?
    };

    // The data borrow is released above: the CPI has to serialise the raffle account.
    system_transfer(buyer, raffle, system, cost)?;

    let mut d = raffle.try_borrow_mut_data()?;
    let t = ticket_at(ticket_index);
    d[t + T_HOLDER..t + T_HOLDER + 32].copy_from_slice(buyer.key.as_ref());
    d[t + T_COMMITMENT..t + T_COMMITMENT + 32].copy_from_slice(&data[3..35]);
    put_u16(&mut d, H_SOLD, ticket_index);
    rialo_s_msg::msg!("Drawbook: ticket bought");
    Ok(())
}

/* ------------------------------------------------------------- 2 Reveal */

fn reveal(program_id: &Pubkey, accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    require(data.len() == 19, BAD_INSTRUCTION)?;
    let holder = account(accounts, 0)?;
    let raffle = account(accounts, 1)?;
    require(holder.is_signer && holder.is_writable && holder.key != raffle.key, BAD_ACCOUNT)?;
    let ticket_index = get_u16(data, 1);
    let nonce = &data[3..3 + NONCE_LEN];

    let bond = {
        let mut d = open_raffle(program_id, raffle)?;
        let now = now_ms()?;
        let sold = get_u16(&d, H_SOLD);
        require(d[H_STATUS] == STATUS_OPEN, REVEALS_CLOSED)?;
        require(sale_closed(&d, now), REVEALS_NOT_OPEN)?;
        require(now < get_u64(&d, H_REVEAL_DEADLINE), REVEALS_CLOSED)?;
        require(ticket_index >= 1 && ticket_index <= sold, WRONG_TICKET)?;
        let t = ticket_at(ticket_index);
        require(&d[t + T_HOLDER..t + T_HOLDER + 32] == holder.key.as_ref(), NOT_HOLDER)?;
        require(d[t + T_FLAGS] & FLAG_REVEALED == 0, ALREADY_REVEALED)?;
        let expected = draw::commitment(raffle.key.as_ref(), ticket_index, holder.key.as_ref(), nonce);
        require(d[t + T_COMMITMENT..t + T_COMMITMENT + 32] == expected, COMMITMENT_MISMATCH)?;

        d[t + T_NONCE..t + T_NONCE + NONCE_LEN].copy_from_slice(nonce);
        d[t + T_FLAGS] |= FLAG_REVEALED;
        let revealed = get_u16(&d, H_REVEALED).checked_add(1).ok_or(fail(ARITHMETIC))?;
        put_u16(&mut d, H_REVEALED, revealed);
        put_u32(&mut d, H_LAST_REVEAL_SLOT, slot_low32()?);
        get_u64(&d, H_REVEAL_BOND)
    };

    // Revealing earns the bond back at once, which is what makes withholding a reveal cost
    // something: the bonds of tickets never revealed stay behind and join the pool.
    pay_out(raffle, holder, bond)?;
    rialo_s_msg::msg!("Drawbook: ticket revealed");
    Ok(())
}

/* ------------------------------------------------------------- 3 Draw */

fn draw_raffle(program_id: &Pubkey, accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    require(data.len() == 1, BAD_INSTRUCTION)?;
    let caller = account(accounts, 0)?;
    let raffle = account(accounts, 1)?;
    let sysvar = account(accounts, 2)?;
    require(caller.is_signer, BAD_ACCOUNT)?;
    require(runs_alone(sysvar)?, DRAW_MUST_RUN_ALONE)?;

    let mut d = open_raffle(program_id, raffle)?;
    require(d[H_STATUS] == STATUS_OPEN, ALREADY_SETTLED)?;
    let now = now_ms()?;
    let sold = get_u16(&d, H_SOLD);
    let revealed = get_u16(&d, H_REVEALED);
    // Ready when reveals have closed, or when the sale is over and every sold ticket is already
    // revealed, so a raffle whose holders all showed up settles without idling to the deadline.
    let ready = now >= get_u64(&d, H_REVEAL_DEADLINE) || (sale_closed(&d, now) && revealed == sold);
    require(ready, NOT_READY)?;
    // Every transaction in a block reads the same chain value, so a reveal sent in the same block
    // as the draw could be decided after computing the result. One block later, it cannot.
    require(revealed == 0 || get_u32(&d, H_LAST_REVEAL_SLOT) != slot_low32()?, TOO_SOON)?;

    if revealed == 0 {
        d[H_STATUS] = STATUS_VOID;
        put_u64(&mut d, H_DRAWN_AT, now);
        rialo_s_msg::msg!("Drawbook: raffle void, nobody revealed");
        return Ok(());
    }

    // Read only now, after every nonce is public. Whoever produces this block could try
    // candidate values if they can influence the seed at all; SPEC.md states that limit openly.
    // Nobody else can: this instruction runs alone, in a later block than the last reveal, and
    // the runtime offers no way to simulate a transaction ahead of time.
    let chain_seed = rialo_s_random_seed::get_random_seed().map_err(|_| ProgramError::UnsupportedSysvar)?;

    let mut nonces: Vec<u128> = Vec::with_capacity(revealed as usize);
    let mut eligible: Vec<u16> = Vec::with_capacity(revealed as usize);
    for i in 1..=sold {
        let t = ticket_at(i);
        if d[t + T_FLAGS] & FLAG_REVEALED != 0 {
            let mut n = [0u8; NONCE_LEN];
            n.copy_from_slice(&d[t + T_NONCE..t + T_NONCE + NONCE_LEN]);
            nonces.push(u128::from_be_bytes(n));
            eligible.push(i);
        }
    }
    let seed = draw::seed(raffle.key.as_ref(), &mut nonces, chain_seed);

    let effective = core::cmp::min(get_u16(&d, H_WINNERS), revealed);
    let prize = get_u64(&d, H_PRIZE);
    let price = get_u64(&d, H_TICKET_PRICE);
    let bond = get_u64(&d, H_REVEAL_BOND);
    let sales = arith(price.checked_mul(sold as u64))?;
    let forfeited = arith(bond.checked_mul((sold - revealed) as u64))?;
    let pool = arith(prize.checked_add(sales).and_then(|v| v.checked_add(forfeited)))?;
    let per_winner = arith(pool.checked_div(effective as u64))?;

    for (rank, winner) in draw::winners(&eligible, &seed, effective).into_iter().enumerate() {
        let t = ticket_at(winner);
        d[t + T_FLAGS] |= FLAG_WON;
        put_u16(&mut d, t + T_WIN_RANK, rank as u16 + 1);
    }

    put_u16(&mut d, H_EFFECTIVE_WINNERS, effective);
    put_u64(&mut d, H_DRAWN_AT, now);
    put_u64(&mut d, H_CHAIN_SEED, chain_seed);
    d[H_SEED..H_SEED + 32].copy_from_slice(&seed);
    put_u64(&mut d, H_POOL, pool);
    put_u64(&mut d, H_PER_WINNER, per_winner);
    d[H_STATUS] = STATUS_DRAWN;
    rialo_s_msg::msg!("Drawbook: winners drawn");
    Ok(())
}

/* ------------------------------------------------------------- 4 Claim */

fn claim(program_id: &Pubkey, accounts: &[AccountInfo<'_>], data: &[u8]) -> ProgramResult {
    require(data.len() == 3, BAD_INSTRUCTION)?;
    let raffle = account(accounts, 0)?;
    let recipient = account(accounts, 1)?;
    // No signer: the payout can only ever reach the recorded holder (or creator), so anyone may
    // push it, which lets one person settle a whole raffle for everyone.
    require(recipient.is_writable && recipient.key != raffle.key, BAD_ACCOUNT)?;
    let ticket_index = get_u16(data, 1);

    let amount = {
        let mut d = open_raffle(program_id, raffle)?;
        let sold = get_u16(&d, H_SOLD);
        let status = d[H_STATUS];
        require(status != STATUS_OPEN, NOTHING_TO_CLAIM)?;

        if status == STATUS_VOID && ticket_index == 0 {
            require(&d[H_CREATOR..H_CREATOR + 32] == recipient.key.as_ref(), NOT_HOLDER)?;
            require(d[H_CREATOR_REFUNDED] == 0, NOTHING_TO_CLAIM)?;
            d[H_CREATOR_REFUNDED] = 1;
            get_u64(&d, H_PRIZE)
        } else {
            require(ticket_index >= 1 && ticket_index <= sold, WRONG_TICKET)?;
            let t = ticket_at(ticket_index);
            let flags = d[t + T_FLAGS];
            let won = flags & FLAG_WON != 0;
            require(status == STATUS_VOID || won, NOTHING_TO_CLAIM)?;
            require(flags & FLAG_PAID == 0, NOTHING_TO_CLAIM)?;
            require(&d[t + T_HOLDER..t + T_HOLDER + 32] == recipient.key.as_ref(), NOT_HOLDER)?;
            d[t + T_FLAGS] = flags | FLAG_PAID;

            if status == STATUS_VOID {
                arith(get_u64(&d, H_TICKET_PRICE).checked_add(get_u64(&d, H_REVEAL_BOND)))?
            } else {
                let per_winner = get_u64(&d, H_PER_WINNER);
                let mut amount = per_winner;
                // The integer-division remainder goes to the first ticket drawn, so the pool is
                // paid out to the last kelvin and the account ends at its rent reserve.
                if get_u16(&d, t + T_WIN_RANK) == 1 {
                    let effective = get_u16(&d, H_EFFECTIVE_WINNERS) as u64;
                    let paid = arith(per_winner.checked_mul(effective))?;
                    let remainder = arith(get_u64(&d, H_POOL).checked_sub(paid))?;
                    amount = arith(amount.checked_add(remainder))?;
                }
                amount
            }
        }
    };

    pay_out(raffle, recipient, amount)?;
    rialo_s_msg::msg!("Drawbook: payout claimed");
    Ok(())
}
