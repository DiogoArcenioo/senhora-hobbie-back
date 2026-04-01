import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { ILike, Repository } from 'typeorm';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { Usuario } from './entities/usuario.entity';

type UsuarioSemSenha = Omit<Usuario, 'senha_hash'>;

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
  ) {}

  async create(createUsuarioDto: CreateUsuarioDto): Promise<UsuarioSemSenha> {
    const nomeNormalizado = this.normalizeUpper(createUsuarioDto.nome);
    const emailNormalizado = this.normalizeUpper(createUsuarioDto.email);

    const usuarioComEmail = await this.usuariosRepository.findOne({
      where: { email: ILike(emailNormalizado) },
    });

    if (usuarioComEmail) {
      throw new ConflictException('Email ja cadastrado');
    }

    const senhaHash = await this.normalizeSenhaHash(
      createUsuarioDto.senha_hash,
    );

    const usuario = this.usuariosRepository.create({
      ...createUsuarioDto,
      nome: nomeNormalizado,
      email: emailNormalizado,
      senha_hash: senhaHash ?? null,
      ativo: createUsuarioDto.ativo ?? true,
    });
    const usuarioSalvo = await this.usuariosRepository.save(usuario);

    return this.sanitize(usuarioSalvo);
  }

  async findAll(): Promise<UsuarioSemSenha[]> {
    const usuarios = await this.usuariosRepository.find({
      order: { id: 'ASC' },
    });

    return usuarios.map((usuario) => this.sanitize(usuario));
  }

  async findOne(id: string): Promise<UsuarioSemSenha> {
    const usuario = await this.findOneOrFail(id);
    return this.sanitize(usuario);
  }

  async update(
    id: string,
    updateUsuarioDto: UpdateUsuarioDto,
  ): Promise<UsuarioSemSenha> {
    const usuario = await this.findOneOrFail(id);

    if (updateUsuarioDto.email && updateUsuarioDto.email !== usuario.email) {
      const usuarioComEmail = await this.usuariosRepository.findOne({
        where: { email: updateUsuarioDto.email },
      });

      if (usuarioComEmail) {
        throw new ConflictException('Email ja cadastrado');
      }
    }

    const dadosAtualizacao: UpdateUsuarioDto = { ...updateUsuarioDto };
    const senhaHash = await this.normalizeSenhaHash(
      updateUsuarioDto.senha_hash,
    );

    if (senhaHash !== undefined) {
      dadosAtualizacao.senha_hash = senhaHash;
    }

    this.usuariosRepository.merge(usuario, dadosAtualizacao);
    const usuarioAtualizado = await this.usuariosRepository.save(usuario);

    return this.sanitize(usuarioAtualizado);
  }

  async remove(id: string): Promise<{ message: string }> {
    const usuario = await this.findOneOrFail(id);
    await this.usuariosRepository.remove(usuario);

    return { message: 'Usuario removido com sucesso' };
  }

  private async findOneOrFail(id: string): Promise<Usuario> {
    const usuario = await this.usuariosRepository.findOne({ where: { id } });

    if (!usuario) {
      throw new NotFoundException(`Usuario com id ${id} nao encontrado`);
    }

    return usuario;
  }

  private sanitize(usuario: Usuario): UsuarioSemSenha {
    const { senha_hash: _, ...usuarioSemSenha } = usuario;
    return usuarioSemSenha;
  }

  private async normalizeSenhaHash(
    senhaHash?: string | null,
  ): Promise<string | null | undefined> {
    if (senhaHash === undefined) {
      return undefined;
    }

    if (senhaHash === null) {
      return null;
    }

    const senhaLimpa = senhaHash.trim();

    if (senhaLimpa.length === 0) {
      return null;
    }

    if (this.isBcryptHash(senhaLimpa)) {
      return senhaLimpa;
    }

    return hash(senhaLimpa, 10);
  }

  private isBcryptHash(senhaHash: string): boolean {
    return (
      senhaHash.startsWith('$2a$') ||
      senhaHash.startsWith('$2b$') ||
      senhaHash.startsWith('$2y$')
    );
  }

  private normalizeUpper(value: string): string {
    return value.trim().toUpperCase();
  }
}
